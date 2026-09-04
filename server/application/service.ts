import { EventEmitter } from "node:events";
import { randomInt } from "node:crypto";
import {
  type Room,
  type Seat,
  type Session,
  type Sealed,
  type Environment,
  RuleError,
  IntegrityError,
  demand,
  plus,
  before,
  micros,
  active,
} from "../domain/model.js";
import {
  startGame,
  gameCommand,
  timeout,
  rotate,
  abandon,
  validateRoom,
} from "../domain/engine.js";
import { project, directory } from "../projection/project.js";
import { botCommand } from "./bot.js";
import {
  type Repository,
  type Write,
  type Receipt,
} from "../persistence/repository.js";
import { Security, canonical } from "../security/crypto.js";
import type { Command } from "../../shared/protocol/schema.js";

export class GameService extends EventEmitter {
  rooms = new Map<string, Room>();
  sessions = new Map<string, Session>();
  sealed = new Map<string, Sealed>();
  ready = false;
  private chain: Promise<any> = Promise.resolve();
  private timers = new Map<string, NodeJS.Timeout>();
  private bots = new Map<string, NodeJS.Timeout>();
  private ordinal = 0n;
  private shuttingDown = false;
  constructor(
    public repo: Repository,
    public security: Security,
    public env: Environment = security.environment(),
    private scheduling = true,
  ) {
    super();
    repo.onFatal = () => this.fatal();
  }
  enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.chain.then(() => {
      demand(!this.shuttingDown, "UNAVAILABLE");
      return work();
    });
    this.chain = result.catch((e) => {
      if (!(e instanceof RuleError)) {
        console.error(
          "Authoritative operation failed:",
          e instanceof Error ? e.message : "unknown",
        );
        this.fatal();
      }
    });
    return result;
  }
  async publication(work: () => void) {
    demand(!this.shuttingDown, "UNAVAILABLE");
    await this.repo.publish(() => {
      demand(!this.shuttingDown, "UNAVAILABLE");
      work();
    });
  }
  fatal() {
    if (this.shuttingDown) return;
    this.ready = false;
    this.shuttingDown = true;
    for (const t of this.timers.values()) clearTimeout(t);
    for (const t of this.bots.values()) clearTimeout(t);
    this.emit("fatal");
  }
  async initialize() {
    await this.repo.initialize();
    for (const r of await this.repo.load("room")) {
      validateRoom(r, this.env);
      this.rooms.set(r.roomId, r);
    }
    for (const s of await this.repo.load("session"))
      this.sessions.set(s.digest, s);
    for (const s of await this.repo.load("sealed"))
      this.sealed.set(this.sealKey(s), s);
    for (const r of this.rooms.values())
      for (const s of r.seats.filter(
        (s) => s.kind === "human" && s.membershipState === "bound",
      )) {
        const session = this.sessions.get(s.sessionDigest!);
        if (
          session?.binding?.roomId !== r.roomId ||
          session.binding.playerId !== s.playerId
        )
          throw new Error("Membership recovery mismatch");
      }
    // Complete durable admissions before invalidating old leases or applying due timers.
    for (const receipt of await this.repo.pending())
      await this.processCommand(
        receipt.principal,
        receipt.value.leaseId,
        receipt.value.command,
        receipt.value.receivedAt,
        true,
        receipt,
      );
    const now = this.env.now();
    await this.atomic("PresenceRecovered", now, () => {
      for (const s of this.sessions.values()) delete s.lease;
      for (const r of this.rooms.values()) {
        const hadConnected = r.seats.some(
          (p) => p.kind === "human" && p.connected,
        );
        for (const p of r.seats) if (p.kind === "human") p.connected = false;
        if (hadConnected) {
          if (r.status === "lobby") {
            if (!r.emptyLobbyExpiry)
              r.emptyLobbyExpiry = {
                timerId: this.env.id(),
                deadline: plus(now, r.lifecyclePolicy.emptyLobbyMs),
              };
            if (!r.hostSuccession)
              r.hostSuccession = {
                timerId: this.env.id(),
                deadline: plus(now, r.lifecyclePolicy.hostGraceMs),
                state: "grace",
              };
          } else if (r.status === "active" && !r.allHumansDisconnected)
            r.allHumansDisconnected = {
              timerId: this.env.id(),
              deadline: plus(
                now,
                r.game!.configuration.timersMs.allHumansDisconnected,
              ),
            };
        }
      }
    });
    for (const r of this.rooms.values()) await this.drain(r.roomId, now);
    await this.repo.recovered?.();
    this.ready = true;
    this.schedule();
  }
  private sealKey(s: Pick<Sealed, "roomId" | "promptId" | "playerId">) {
    return s.roomId + ":" + s.promptId + ":" + s.playerId;
  }
  decisions(r: Room) {
    return [...this.sealed.values()].filter(
      (s) =>
        s.roomId === r.roomId &&
        r.game?.phase.kind === "awaitingSimultaneousCards" &&
        s.promptId === r.game.phase.promptId,
    );
  }
  private async atomic(
    type: string,
    effectiveAt: string,
    apply: () => any,
    receipt?: Receipt,
    beforeCommit?: () => void,
  ): Promise<any> {
    const previousRooms = structuredClone(this.rooms),
      previousSessions = structuredClone(this.sessions),
      previousSealed = structuredClone(this.sealed);
    let committed = false;
    try {
      const result = apply();
      const writes: Write[] = [];
      const changed: string[] = [];
      for (const [id, r] of this.rooms) {
        if (canonical(r) !== canonical(previousRooms.get(id))) {
          r.stateVersion = (previousRooms.get(id)?.stateVersion ?? 0) + 1;
          validateRoom(r, this.env);
          writes.push({
            family: "room",
            id,
            value: r,
            version: r.stateVersion,
            previous: previousRooms.get(id),
            event: {
              type,
              effectiveAt,
              ...(receipt ? { commandId: receipt.commandId } : {}),
            },
          });
          changed.push(id);
        }
      }
      for (const [id, s] of this.sessions)
        if (canonical(s) !== canonical(previousSessions.get(id)))
          writes.push({
            family: "session",
            id,
            value: s,
            version: s.generation,
          });
      for (const [id, s] of this.sealed)
        if (canonical(s) !== canonical(previousSealed.get(id)))
          writes.push({ family: "sealed", id, value: s, version: 1 });
      for (const [id] of previousSealed)
        if (!this.sealed.has(id))
          writes.push({ family: "sealed", id, value: null, version: 1 });
      if (receipt) {
        receipt.value.result = {
          protocolVersion: 1,
          kind: "commandResult",
          commandId: receipt.commandId,
          status: "accepted",
          replayed: false,
          ...(changed.length
            ? { appliedStateVersion: this.rooms.get(changed[0])!.stateVersion }
            : {}),
          ...(result ? { data: result } : {}),
        };
        receipt.value.roomId = result?.roomId ?? receipt.value.command?.roomId;
        const session = this.sessions.get(receipt.principal);
        receipt.value.generation = session?.binding?.generation;
        delete receipt.value.command;
        delete receipt.value.leaseId;
        delete receipt.value.receivedAt;
      }
      await this.repo.commit(writes, receipt, beforeCommit);
      committed = true;
      this.schedule();
      await this.publication(() => {
        for (const id of changed) this.emit("room", id);
        if (changed.length) this.emit("directory");
        for (const [digest, prior] of previousSessions) {
          const next = this.sessions.get(digest);
          if (prior.binding && !next?.binding)
            this.emit(
              "membershipEnded",
              digest,
              prior.binding.roomId,
              type === "room.leave"
                ? "left"
                : type === "room.removePlayer"
                  ? "removed"
                  : "roomClosed",
            );
        }
      });
      return result;
    } catch (e) {
      if (committed) this.fatal();
      else {
        this.rooms = previousRooms;
        this.sessions = previousSessions;
        this.sealed = previousSealed;
      }
      throw e;
    }
  }
  async authenticate(
    raw: string | undefined,
    at = this.env.now(),
  ): Promise<{ session: Session; credential?: string }> {
    const digest = raw ? this.security.credentialDigest(raw) : null;
    let current = digest ? this.sessions.get(digest) : undefined;
    if (current?.retired) current = undefined;
    if (
      current &&
      !current.binding &&
      !current.lease &&
      !before(
        at,
        current.retainUntil && before(current.expiresAt, current.retainUntil)
          ? current.retainUntil
          : current.expiresAt,
      )
    )
      current = undefined;
    let credential: string | undefined;
    let s: Session;
    if (current) s = current;
    else {
      credential = this.security.newCredential();
      s = {
        digest: this.security.credentialDigest(credential)!,
        createdAt: at,
        lastAuthenticatedAt: at,
        expiresAt: plus(at, 7 * 86400000),
        generation: 0,
      };
    }
    await this.atomic("SessionAuthenticated", at, () => {
      if (!current) this.sessions.set(s.digest, s);
      if (before(s.lastAuthenticatedAt, at)) s.lastAuthenticatedAt = at;
      s.expiresAt = plus(s.lastAuthenticatedAt, 7 * 86400000);
    });
    return { session: s, credential };
  }
  private current(digest: string, leaseId: string) {
    const s = this.sessions.get(digest);
    demand(s && !s.retired, "AUTH_REQUIRED");
    demand(
      s.lease?.id === leaseId && s.lease.epoch === this.repo.epoch,
      "CONNECTION_SUPERSEDED",
    );
    return s;
  }
  async acquire(digest: string, at: string, isOpen: () => boolean) {
    const s = this.sessions.get(digest);
    demand(s && !s.retired, "AUTH_REQUIRED");
    if (s.binding) await this.drain(s.binding.roomId, at);
    demand(isOpen(), "CONNECTION_CLOSED");
    const old = s.lease?.id,
      leaseId = this.env.id();
    await this.atomic(
      "ConnectionAcquired",
      at,
      () => {
        demand(isOpen(), "CONNECTION_CLOSED");
        s.lease = { id: leaseId, epoch: this.repo.epoch };
        if (s.binding) {
          const r = this.rooms.get(s.binding.roomId)!,
            p = r.seats.find((p) => p.playerId === s.binding!.playerId)!;
          p.connected = true;
          this.presence(r, at);
        }
      },
      undefined,
      () => demand(isOpen(), "CONNECTION_CLOSED"),
    );
    return { leaseId, old };
  }
  async disconnect(digest: string, leaseId: string, at: string) {
    const s = this.sessions.get(digest);
    if (s?.lease?.id !== leaseId) return;
    if (s.binding) await this.drain(s.binding.roomId, at);
    await this.atomic("ConnectionReleased", at, () => {
      if (s.lease?.id !== leaseId) return;
      delete s.lease;
      if (s.binding) {
        const r = this.rooms.get(s.binding.roomId)!,
          p = r.seats.find((p) => p.playerId === s.binding!.playerId)!;
        p.connected = false;
        this.presence(r, at);
      }
    });
  }
  private presence(r: Room, at: string) {
    const connected = r.seats.filter(
      (s) => s.kind === "human" && s.membershipState === "bound" && s.connected,
    );
    if (r.status === "lobby") {
      if (connected.length) delete r.emptyLobbyExpiry;
      else if (!r.emptyLobbyExpiry)
        r.emptyLobbyExpiry = {
          timerId: this.env.id(),
          deadline: plus(at, r.lifecyclePolicy.emptyLobbyMs),
        };
      const host = r.seats.find((s) => s.playerId === r.hostPlayerId);
      if (host?.connected) delete r.hostSuccession;
      else if (
        r.hostSuccession?.state === "awaitingConnectedSuccessor" ||
        !host
      ) {
        if (connected.length) {
          r.hostPlayerId = connected.sort(
            (a, b) => a.joinedOrdinal - b.joinedOrdinal,
          )[0].playerId;
          r.hostGeneration++;
          delete r.hostSuccession;
        } else
          r.hostSuccession = {
            timerId: this.env.id(),
            deadline: at,
            state: "awaitingConnectedSuccessor",
          };
      } else if (!r.hostSuccession)
        r.hostSuccession = {
          timerId: this.env.id(),
          deadline: plus(at, r.lifecyclePolicy.hostGraceMs),
          state: "grace",
        };
    } else if (r.status === "active") {
      if (connected.length) delete r.allHumansDisconnected;
      else if (!r.allHumansDisconnected)
        r.allHumansDisconnected = {
          timerId: this.env.id(),
          deadline: plus(
            at,
            r.game!.configuration.timersMs.allHumansDisconnected,
          ),
        };
    }
  }
  private human(displayName: string, digest: string, ordinal: number): Seat {
    return {
      playerId: this.env.id(),
      sessionDigest: digest,
      seatIndex: 0,
      joinedOrdinal: ordinal,
      displayName,
      kind: "human",
      ready: false,
      connected: true,
      membershipState: "bound",
      status: "active",
      souls: 0,
      hand: [],
      faceUpSins: [],
    };
  }
  private botsFor(r: Room) {
    r.seats = r.seats.filter((s) => s.kind === "human");
    const names = [
      "La Sombra",
      "El Oráculo",
      "La Duda",
      "El Espectro",
      "La Máscara",
    ];
    for (let i = 0; i < r.config.botPlayers; i++)
      r.seats.push({
        playerId: this.env.id(),
        seatIndex: 0,
        joinedOrdinal: 100 + i,
        displayName: names[i],
        kind: "bot",
        ready: true,
        connected: true,
        membershipState: "notApplicable",
        status: "active",
        souls: 0,
        hand: [],
        faceUpSins: [],
      });
    r.seats.forEach((p, i) => (p.seatIndex = i));
  }
  private code() {
    let c: string;
    do {
      c = String(randomInt(1000000)).padStart(6, "0");
    } while ([...this.rooms.values()].some((r) => r.privateCode === c));
    return c;
  }
  private bind(s: Session, r: Room, p: Seat) {
    s.generation++;
    s.binding = {
      roomId: r.roomId,
      playerId: p.playerId,
      generation: s.generation,
    };
  }
  private release(p: Seat, at: string, retain = false) {
    if (p.kind === "bot" || p.membershipState === "released") return;
    const s = this.sessions.get(p.sessionDigest!)!;
    delete s.binding;
    s.generation++;
    if (retain) {
      const until = plus(at, 86400000);
      if (!s.retainUntil || before(s.retainUntil, until)) s.retainUntil = until;
    }
    p.membershipState = "released";
    p.connected = false;
  }
  private closeRoom(r: Room, at: string, retain: boolean) {
    for (const p of r.seats) this.release(p, at, retain);
    r.status = "closed";
    r.seats = [];
    delete r.game;
    delete r.integrityFault;
    delete r.privateCode;
    delete r.hostSuccession;
    delete r.emptyLobbyExpiry;
    delete r.allHumansDisconnected;
    delete r.memberFacingExpiry;
    this.clearSealed(r.roomId);
  }
  private clearSealed(roomId: string) {
    for (const [id, s] of this.sealed)
      if (s.roomId === roomId) this.sealed.delete(id);
  }
  private config(payload: any, current?: Room["config"]) {
    const a = payload.additionalHumanPlayers ?? current?.additionalHumanPlayers,
      b = payload.botPlayers ?? current?.botPlayers;
    demand(
      Number.isInteger(a) &&
        a >= 0 &&
        a <= 5 &&
        Number.isInteger(b) &&
        b >= 0 &&
        b <= 5 &&
        1 + a + b >= 3 &&
        1 + a + b <= 6,
      "INVALID_ROOM_CONFIG",
    );
    return {
      additionalHumanPlayers: a,
      botPlayers: b,
      totalPlayers: 1 + a + b,
    };
  }
  async processCommand(
    digest: string,
    leaseId: string,
    command: Command,
    receivedAt: string,
    recovery = false,
    pendingReceipt?: Receipt,
  ): Promise<any> {
    let s = this.sessions.get(digest);
    if (!recovery) s = this.current(digest, leaseId);
    demand(s, "AUTH_REQUIRED");
    const commandDigest = this.security.hmac("command", command),
      existing =
        pendingReceipt ?? (await this.repo.receipt(digest, command.commandId));
    if (existing) {
      demand(existing.digest === commandDigest, "COMMAND_ID_REUSED");
      if (existing.status === "final") return this.result(existing, true, s);
    }
    const receipt: Receipt = existing ?? {
      principal: digest,
      commandId: command.commandId,
      digest: commandDigest,
      status: "pending",
      value: { command, leaseId, receivedAt },
    };
    const timed = command.type.startsWith("game.");
    if (timed && !existing) {
      await this.repo.commit([], receipt);
    }
    const roomId = s.binding?.roomId;
    if (roomId) await this.drain(roomId, receivedAt);
    else if (command.type === "room.joinPublic" && command.roomId)
      await this.drain(command.roomId, receivedAt);
    else if (command.type === "room.joinPrivate") {
      const found = command.roomId
        ? this.rooms.get(command.roomId)
        : [...this.rooms.values()].find(
            (r) => r.privateCode === command.payload.code,
          );
      if (found) await this.drain(found.roomId, receivedAt);
    }
    // Drain can release membership at exact expiry; refresh the current authenticated session.
    s = this.sessions.get(digest)!;
    receipt.status = "final";
    try {
      await this.atomic(
        command.type,
        receivedAt,
        () => {
          const data = command.payload;
          if (
            ["room.create", "room.joinPublic", "room.joinPrivate"].includes(
              command.type,
            )
          ) {
            demand(!s!.binding, "ALREADY_IN_ROOM");
            if (command.type === "room.create") {
              demand(
                [...this.rooms.values()].filter((r) => r.status !== "closed")
                  .length < 500,
                "ROOM_NOT_FOUND_OR_UNAVAILABLE",
              );
              const config = this.config(data),
                p = this.human(data.displayName, digest, 1),
                r: Room = {
                  roomId: this.env.id(),
                  createdAt: receivedAt,
                  visibility: data.visibility,
                  privateCodeGeneration: 0,
                  hostPlayerId: p.playerId,
                  hostGeneration: 1,
                  nextJoinedOrdinal: 2,
                  stateVersion: 0,
                  status: "lobby",
                  config,
                  lifecyclePolicy: {
                    version: 1,
                    hostGraceMs: 60000,
                    emptyLobbyMs: 1800000,
                    memberFacingRetentionMs: 900000,
                  },
                  seats: [p],
                };
              if (r.visibility === "private") {
                r.privateCode = this.code();
                r.privateCodeGeneration = 1;
              }
              this.botsFor(r);
              this.rooms.set(r.roomId, r);
              this.bind(s!, r, p);
              return {
                roomId: r.roomId,
                ...(r.privateCode ? { privateCode: r.privateCode } : {}),
              };
            }
            const privateJoin = command.type === "room.joinPrivate";
            const r = privateJoin && !command.roomId
              ? [...this.rooms.values()].find(
                  (r) => r.privateCode === data.code,
                )
              : this.rooms.get(command.roomId!);
            demand(
              r &&
                r.status === "lobby" &&
                r.visibility === (privateJoin ? "private" : "public") &&
                (!privateJoin || r.privateCode === data.code),
              "ROOM_NOT_FOUND_OR_UNAVAILABLE",
            );
            demand(
              r.seats.filter((s) => s.kind === "human").length <
                1 + r.config.additionalHumanPlayers,
              privateJoin ? "ROOM_NOT_FOUND_OR_UNAVAILABLE" : "ROOM_FULL",
            );
            const p = this.human(
              data.displayName,
              digest,
              r.nextJoinedOrdinal++,
            );
            r.seats.splice(
              r.seats.filter((s) => s.kind === "human").length,
              0,
              p,
            );
            r.seats.forEach((s, i) => (s.seatIndex = i));
            this.bind(s!, r, p);
            this.presence(r, receivedAt);
            return { roomId: r.roomId };
          }
          demand(
            s!.binding && s!.binding.roomId === command.roomId,
            "AUTH_REQUIRED",
          );
          const r = this.rooms.get(command.roomId!)!;
          const p = r.seats.find((p) => p.playerId === s!.binding!.playerId)!;
          if (timed) {
            const result = gameCommand(
              r,
              p.playerId,
              command,
              this.env,
              receivedAt,
              this.decisions(r),
            );
            if (result.sealed) {
              result.sealed.ordinal = String(++this.ordinal);
              this.sealed.set(this.sealKey(result.sealed), result.sealed);
              const decisions = this.decisions(r);
              if (
                active(r).every(
                  (p) =>
                    p.hand.length === 1 ||
                    decisions.some((s) => s.playerId === p.playerId),
                )
              ) {
                rotate(
                  r,
                  Object.fromEntries(
                    active(r).map((p) => [
                      p.playerId,
                      p.hand.length === 1
                        ? p.hand[0]
                        : decisions.find((s) => s.playerId === p.playerId)!
                            .cardId,
                    ]),
                  ),
                  this.env,
                );
                this.clearSealed(r.roomId);
              }
            } else if (r.game!.phase.kind !== "awaitingSimultaneousCards")
              this.clearSealed(r.roomId);
            return;
          }
          demand(
            command.expectedStateVersion === r.stateVersion,
            "STALE_STATE",
          );
          if (command.type === "room.leave") {
            demand(
              ["lobby", "finished", "faulted"].includes(r.status),
              "INVALID_PHASE",
            );
            this.release(p, receivedAt);
            if (r.status === "lobby") {
              r.seats = r.seats.filter((s) => s !== p);
              if (!r.seats.some((s) => s.kind === "human"))
                this.closeRoom(r, receivedAt, false);
              else {
                r.seats.forEach((s, i) => (s.seatIndex = i));
                if (r.hostPlayerId === p.playerId) {
                  r.hostPlayerId = null;
                  delete r.hostSuccession;
                }
                this.presence(r, receivedAt);
              }
            }
            return;
          }
          demand(r.status === "lobby", "INVALID_PHASE");
          if (command.type === "room.setReady") {
            p.ready = data.ready;
            return;
          }
          demand(r.hostPlayerId === p.playerId && p.connected, "NOT_HOST");
          if (command.type === "room.configure") {
            const config = this.config(data, r.config),
              visibility = data.visibility ?? r.visibility;
            demand(
              config.additionalHumanPlayers + 1 >=
                r.seats.filter((s) => s.kind === "human").length,
              "INVALID_ROOM_CONFIG",
            );
            if (
              canonical(config) === canonical(r.config) &&
              visibility === r.visibility
            )
              return;
            const changedBots = config.botPlayers !== r.config.botPlayers;
            r.config = config;
            if (visibility !== r.visibility) {
              r.visibility = visibility;
              r.privateCodeGeneration++;
              if (visibility === "private") r.privateCode = this.code();
              else delete r.privateCode;
            }
            for (const s of r.seats)
              if (s.kind === "human" && s !== p) s.ready = false;
            if (changedBots) this.botsFor(r);
            return r.privateCode
              ? { privateCode: r.privateCode, roomId: r.roomId }
              : undefined;
          }
          if (command.type === "room.removePlayer") {
            const target = r.seats.find(
              (t) =>
                t.playerId === data.targetPlayerId &&
                t.kind === "human" &&
                t !== p,
            );
            demand(target, "INVALID_TARGET");
            this.release(target, receivedAt);
            r.seats = r.seats.filter((s) => s !== target);
            r.seats.forEach((p, i) => (p.seatIndex = i));
            return;
          }
          if (command.type === "room.start") {
            startGame(r, this.env);
            this.presence(r, receivedAt);
            return;
          }
          throw new RuleError("INVALID_PHASE");
        },
        receipt,
      );
    } catch (e) {
      if (e instanceof IntegrityError && command.roomId) {
        await this.fault(command.roomId, receivedAt);
        e = new RuleError("MATCH_INTEGRITY_FAILURE");
      }
      if (!(e instanceof RuleError)) throw e;
      receipt.value = {
        result: {
          protocolVersion: 1,
          kind: "commandResult",
          commandId: command.commandId,
          status: "rejected",
          code: e.code,
          replayed: false,
          ...(e.code === "ALREADY_IN_ROOM" && s.binding
            ? { data: { resumableRoomId: s.binding.roomId } }
            : {}),
        },
      };
      await this.repo.commit([], receipt);
    }
    return this.result(receipt, false, this.sessions.get(digest)!);
  }
  private result(receipt: Receipt, replayed: boolean, s: Session) {
    const result = structuredClone(receipt.value.result);
    result.replayed = replayed;
    if (result.data && receipt.value.roomId) {
      if (
        s.binding?.roomId !== receipt.value.roomId ||
        s.binding?.generation !== receipt.value.generation
      )
        delete result.data;
      else if (
        result.data.privateCode !==
        this.rooms.get(receipt.value.roomId)?.privateCode
      )
        delete result.data.privateCode;
    }
    return result;
  }
  private async fault(roomId: string, at: string) {
    const evidence = structuredClone(this.rooms.get(roomId)!);
    const reference = this.env.id();
    await this.repo.commit([
      { family: "incident", id: reference, value: evidence, version: 1 },
    ]);
    await this.atomic("RoomIntegrityFaulted", at, () => {
      const r = this.rooms.get(roomId)!;
      r.integrityFault = {
        reference,
        configurationHash: r.game!.configurationHash,
        rulesetId: r.game!.rulesetId,
      };
      delete r.game;
      r.status = "faulted";
      delete r.allHumansDisconnected;
      r.memberFacingExpiry = {
        timerId: this.env.id(),
        deadline: plus(at, r.lifecyclePolicy.memberFacingRetentionMs),
      };
      for (const p of r.seats) {
        p.hand = [];
        p.faceUpSins = [];
        p.souls = 0;
        p.status = "active";
      }
      this.clearSealed(roomId);
    });
  }
  snapshot(digest: string) {
    const s = this.sessions.get(digest);
    if (!s?.binding) return null;
    const r = this.rooms.get(s.binding.roomId)!;
    return project(r, s.binding.playerId, this.env, this.decisions(r));
  }
  list() {
    return directory([...this.rooms.values()]);
  }
  private timerList(
    r: Room,
  ): { key: string; kind: string; deadline: string; priority: number }[] {
    const result: any[] = [];
    for (const kind of [
      "memberFacingExpiry",
      "emptyLobbyExpiry",
      "allHumansDisconnected",
      "hostSuccession",
    ] as const) {
      const t = r[kind];
      if (
        t &&
        !(kind === "hostSuccession" && r.hostSuccession?.state !== "grace")
      )
        result.push({
          kind,
          key: t.timerId,
          deadline: t.deadline,
          priority: kind === "hostSuccession" ? 1 : 0,
        });
    }
    if (r.status === "active" && r.game!.phase.kind !== "finished") {
      const p = r.game!.phase;
      result.push({
        kind: "gameplay",
        key:
          "opportunityId" in p
            ? p.opportunityId
            : "interactionId" in p
              ? p.interactionId
              : p.promptId,
        deadline: p.deadline,
        priority: 1,
      });
    }
    return result.sort((a, b) =>
      micros(a.deadline) < micros(b.deadline)
        ? -1
        : micros(a.deadline) > micros(b.deadline)
          ? 1
          : a.priority - b.priority ||
            a.kind.localeCompare(b.kind) ||
            a.key.localeCompare(b.key),
    );
  }
  async drain(roomId: string, horizon: string) {
    let count = 0;
    while (true) {
      const r = this.rooms.get(roomId);
      if (!r) return;
      const due = this.timerList(r).find((t) => !before(horizon, t.deadline));
      if (!due) return;
      if (++count > 10000) throw new Error("Timer drain failed to converge");
      await this.atomic("TimerExpired", due.deadline, () => {
        const r = this.rooms.get(roomId)!;
        if (
          due.kind === "memberFacingExpiry" ||
          due.kind === "emptyLobbyExpiry"
        )
          this.closeRoom(r, due.deadline, true);
        else if (due.kind === "allHumansDisconnected") {
          abandon(r, this.env);
          this.clearSealed(roomId);
        } else if (due.kind === "hostSuccession") {
          const candidates = r.seats
            .filter((s) => s.kind === "human" && s.connected)
            .sort((a, b) => a.joinedOrdinal - b.joinedOrdinal);
          if (candidates.length) {
            r.hostPlayerId = candidates[0].playerId;
            r.hostGeneration++;
            delete r.hostSuccession;
          } else r.hostSuccession!.state = "awaitingConnectedSuccessor";
        } else {
          timeout(r, this.env, this.decisions(r));
          if (r.game!.phase.kind !== "awaitingSimultaneousCards")
            this.clearSealed(roomId);
        }
      });
    }
  }
  private schedule() {
    if (!this.scheduling || !this.ready || this.shuttingDown) return;
    const needed = new Set<string>(),
      botNeeded = new Set<string>();
    for (const r of this.rooms.values()) {
      for (const t of this.timerList(r)) {
        const key = r.roomId + ":" + t.key;
        needed.add(key);
        if (!this.timers.has(key)) {
          const delay = Math.max(
            0,
            Math.min(
              2147483647,
              Number((micros(t.deadline) - micros(this.env.now())) / 1000n),
            ),
          );
          this.timers.set(
            key,
            setTimeout(() => {
              this.timers.delete(key);
              if (!this.ready) return;
              void this.enqueue(() => this.drain(r.roomId, t.deadline));
            }, delay).unref(),
          );
        }
      }
      if (r.status === "active")
        for (const p of r.seats.filter(
          (p) => p.kind === "bot" && p.status === "active",
        )) {
          const view = project(r, p.playerId, this.env, this.decisions(r));
          if (!view.self.legalActions.length) continue;
          const phase = r.game!.phase;
          if (phase.kind === "finished") continue;
          const key =
            r.roomId +
            ":" +
            p.playerId +
            ":" +
            ("opportunityId" in phase
              ? phase.opportunityId
              : "interactionId" in phase
                ? phase.interactionId
                : phase.promptId);
          botNeeded.add(key);
          if (this.bots.has(key)) continue;
          const config = r.game!.configuration.botPolicy,
            delay =
              config.presentationDelayMinMs +
              randomInt(
                config.presentationDelayMaxMs -
                  config.presentationDelayMinMs +
                  1,
              );
          this.bots.set(
            key,
            setTimeout(() => {
              this.bots.delete(key);
              if (!this.ready) return;
              const receivedAt = this.env.now();
              if (!before(receivedAt, phase.deadline)) return;
              const command = botCommand(
                view,
                (n) => randomInt(n),
                this.env.id,
              );
              if (!command) return;
              void this.enqueue(async () => {
                await this.drain(r.roomId, receivedAt);
                const current = this.rooms.get(r.roomId);
                if (!current || current.status !== "active") return;
                try {
                  await this.atomic(command.type, receivedAt, () => {
                    command.expectedStateVersion =
                      command.payload.answer?.kind === "selectHerejiaCard"
                        ? undefined
                        : current.stateVersion;
                    const outcome = gameCommand(
                      current,
                      p.playerId,
                      command,
                      this.env,
                      receivedAt,
                      this.decisions(current),
                    );
                    if (outcome.sealed) {
                      outcome.sealed.ordinal = String(++this.ordinal);
                      this.sealed.set(
                        this.sealKey(outcome.sealed),
                        outcome.sealed,
                      );
                      const decisions = this.decisions(current);
                      if (
                        active(current).every(
                          (p) =>
                            p.hand.length === 1 ||
                            decisions.some((s) => s.playerId === p.playerId),
                        )
                      ) {
                        rotate(
                          current,
                          Object.fromEntries(
                            active(current).map((p) => [
                              p.playerId,
                              p.hand.length === 1
                                ? p.hand[0]
                                : decisions.find(
                                    (s) => s.playerId === p.playerId,
                                  )!.cardId,
                            ]),
                          ),
                          this.env,
                        );
                        this.clearSealed(current.roomId);
                      }
                    } else if (
                      current.game!.phase.kind !== "awaitingSimultaneousCards"
                    )
                      this.clearSealed(current.roomId);
                  });
                } catch (e) {
                  if (e instanceof IntegrityError)
                    await this.fault(current.roomId, receivedAt);
                  else if (!(e instanceof RuleError)) throw e;
                }
              });
            }, delay).unref(),
          );
        }
    }
    for (const [key, t] of this.timers)
      if (!needed.has(key)) {
        clearTimeout(t);
        this.timers.delete(key);
      }
    for (const [key, t] of this.bots)
      if (!botNeeded.has(key)) {
        clearTimeout(t);
        this.bots.delete(key);
      }
  }
  async close() {
    this.ready = false;
    this.shuttingDown = true;
    for (const t of this.timers.values()) clearTimeout(t);
    for (const t of this.bots.values()) clearTimeout(t);
    await this.chain;
    await this.repo.close();
  }
}
