import { randomUUID } from "node:crypto";
import { Security } from "../server/security/crypto.js";
import {
  startGame,
  gameCommand,
  timeout,
  validateRoom,
} from "../server/domain/engine.js";
import {
  type Room,
  type Environment,
  instant,
  plus,
} from "../server/domain/model.js";
import { project } from "../server/projection/project.js";
import type { Command } from "../shared/protocol/schema.js";
export const security = new Security(Buffer.alloc(32, 42));
export function fixture(n = 3, seed = 1) {
  let state = seed,
    now = instant(1770000000000);
  const env: Environment = {
    ...security.environment(() => now),
    integer: (max) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return Math.floor((state / 4294967296) * max);
    },
  };
  const room: Room = {
    roomId: randomUUID(),
    createdAt: now,
    visibility: "private",
    privateCode: "000019",
    privateCodeGeneration: 1,
    hostPlayerId: null,
    hostGeneration: 1,
    nextJoinedOrdinal: n + 1,
    stateVersion: 1,
    status: "lobby",
    config: { additionalHumanPlayers: n - 1, botPlayers: 0, totalPlayers: n },
    lifecyclePolicy: {
      version: 1,
      hostGraceMs: 60000,
      emptyLobbyMs: 1800000,
      memberFacingRetentionMs: 900000,
    },
    seats: Array.from({ length: n }, (_, i) => ({
      playerId: randomUUID(),
      sessionDigest: "test" + i,
      seatIndex: i,
      joinedOrdinal: i,
      displayName: "Jugador " + i,
      kind: "human" as const,
      ready: true,
      connected: true,
      membershipState: "bound" as const,
      status: "active" as const,
      souls: 0,
      hand: [],
      faceUpSins: [],
    })),
  };
  room.hostPlayerId = room.seats[0].playerId;
  startGame(room, env);
  room.game!.activeSeatIndex = 0;
  if (room.game!.phase.kind === "awaitingTurnAction")
    room.game!.phase.actorId = room.seats[0].playerId;
  const run = (type: string, payload: any = {}, playerId?: string) => {
    const v = room.game!,
      phase = v.phase;
    let id = playerId;
    if (!id)
      id =
        "actorId" in phase
          ? phase.actorId
          : "responderId" in phase
            ? phase.responderId
            : "playerId" in phase
              ? phase.playerId
              : room.seats[0].playerId;
    const auto =
      phase.kind === "awaitingTurnAction"
        ? { opportunityId: phase.opportunityId }
        : phase.kind === "awaitingChallenge" || phase.kind === "awaitingCounter"
          ? { interactionId: phase.interactionId }
          : phase.kind === "awaitingPrompt" ||
              phase.kind === "awaitingSimultaneousCards"
            ? { promptId: phase.promptId }
            : {};
    const command: Command = {
      protocolVersion: 1,
      kind: "command",
      commandId: randomUUID(),
      type,
      roomId: room.roomId,
      ...(payload.answer?.kind === "selectHerejiaCard"
        ? {}
        : { expectedStateVersion: room.stateVersion }),
      payload: { ...auto, ...payload },
    };
    const result = gameCommand(room, id!, command, env, now);
    if (!result.sealed) room.stateVersion++;
    return result;
  };
  const pass = () => {
    while (room.game!.phase.kind === "awaitingChallenge")
      run("game.passChallenge");
  };
  const answer = (value: any) => run("game.answerPrompt", { answer: value });
  const settle = () => {
    let limit = 0;
    while (
      room.status === "active" &&
      room.game!.phase.kind !== "awaitingTurnAction"
    ) {
      timeout(room, env);
      room.stateVersion++;
      validateRoom(room, env);
      if (++limit > 30) throw new Error("did not settle");
    }
  };
  const souls = (index: number, n: number) => {
    room.game!.bank += room.seats[index].souls - n;
    room.seats[index].souls = n;
  };
  const hand = (index: number, sin: string) => {
    const p = room.seats[index],
      old = p.hand[0],
      cards = room.game!.cards,
      deck = room.game!.sinDeck;
    const incoming = deck.find((id) => cards[id].definition === sin);
    if (!incoming) {
      if (p.hand.some((id) => cards[id].definition === sin)) return;
      throw new Error("No fixture card in deck");
    }
    const j = deck.indexOf(incoming);
    deck[j] = old;
    p.hand[0] = incoming;
  };
  const conspiracy = (name: string) => {
    const deck = room.game!.conspiracyDeck,
      i = deck.findIndex((id) => room.game!.cards[id].definition === name);
    [deck[0], deck[i]] = [deck[i], deck[0]];
  };
  return {
    room,
    env,
    run,
    pass,
    answer,
    settle,
    souls,
    hand,
    conspiracy,
    view: (index = 0) => project(room, room.seats[index].playerId, env),
    advance: (ms: number) => (now = plus(now, ms)),
  };
}
