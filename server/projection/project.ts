import { COSTS, SINS } from "../../shared/protocol/schema.js";
import {
  type Room,
  type Seat,
  type Environment,
  type Sealed,
  active,
} from "../domain/model.js";
export function project(
  room: Room,
  playerId: string,
  env: Environment,
  sealed: Sealed[] = [],
): any {
  const me = room.seats.find((s) => s.playerId === playerId);
  if (!me || me.membershipState === "released" || room.status === "closed")
    return null;
  const base: any = {
    protocolVersion: 1,
    kind: "stateSnapshot",
    roomId: room.roomId,
    stateVersion: room.stateVersion,
    serverTime: env.now(),
  };
  if (room.status === "faulted")
    return {
      ...base,
      rulesetId: room.integrityFault!.rulesetId,
      matchConfigurationHash: room.integrityFault!.configurationHash,
      public: {
        room: {
          visibility: room.visibility,
          status: room.status,
          memberFacingExpiresAt: room.memberFacingExpiry!.deadline,
        },
        integrityFault: {
          code: "MATCH_INTEGRITY_FAILURE",
          reference: room.integrityFault!.reference,
        },
      },
      self: { legalActions: [{ type: "room.leave" }] },
    };
  const host = room.hostPlayerId === playerId && me.connected;
  const legalActions: any[] = [];
  const pub: any = {
    room: { visibility: room.visibility, status: room.status },
    players: room.seats.map((s) => ({
      playerId: s.playerId,
      seatIndex: s.seatIndex,
      displayName: s.displayName,
      kind: s.kind,
      connected: s.connected,
      ready: s.ready,
      status: s.status,
      souls: s.souls,
      handCount: s.hand.length,
      faceUpSins: s.faceUpSins.map((id) => publicCard(room, id, env)),
    })),
  };
  const self: any = {
    playerId,
    hand: [],
    legalActions,
    prompt: null,
    privateEffects: [],
  };
  if (room.status === "lobby") {
    pub.room.config = { ...room.config };
    pub.lifecycle = {
      hostPlayerId: room.hostPlayerId,
      emptyLobbyExpiresAt: room.emptyLobbyExpiry?.deadline ?? null,
      hostSuccession: room.hostSuccession
        ? room.hostSuccession.state === "grace"
          ? { state: "grace", deadline: room.hostSuccession.deadline }
          : { state: "awaitingConnectedSuccessor" }
        : null,
    };
    legalActions.push({ type: "room.setReady" }, { type: "room.leave" });
    if (host) {
      legalActions.push(
        { type: "room.configure" },
        {
          type: "room.removePlayer",
          eligiblePlayerIds: room.seats
            .filter((s) => s.kind === "human" && s !== me)
            .map((s) => s.playerId),
        },
      );
      if (
        room.seats.length === room.config.totalPlayers &&
        room.seats.every((s) => s.ready)
      )
        legalActions.push({ type: "room.start" });
    }
    if (room.visibility === "private") self.privateCode = room.privateCode;
    return { ...base, public: pub, self };
  }
  const v = room.game!,
    phase = v.phase,
    q = v.pending;
  self.hand = me.hand.map((id) => ({
    handCardRef: env.handRef(room, me, v.cards[id]),
    sin: v.cards[id].definition,
  }));
  pub.board = {
    soulBank: v.bank,
    sinDeckCount: v.sinDeck.length,
    conspiracyDeckCount: v.conspiracyDeck.length,
    revealedConspiracy: v.revealedConspiracy
      ? { conspiracy: v.cards[v.revealedConspiracy].definition }
      : null,
    resolvingSin: v.resolvingSin ? publicCard(room, v.resolvingSin, env) : null,
    publicCenter: v.publicCenter.map((c) => ({
      ...publicCard(room, c.cardId, env),
      formerOwnerId: c.formerOwnerId,
    })),
  };
  pub.turn =
    phase.kind === "finished"
      ? {
          phase: "finished",
          turnNumber: v.turnNumber,
          activePlayerId: null,
          lastActivePlayerId: room.seats[v.activeSeatIndex].playerId,
          deadline: null,
        }
      : {
          phase: phase.kind,
          turnNumber: v.turnNumber,
          activePlayerId: room.seats[v.activeSeatIndex].playerId,
          deadline: phase.deadline,
        };
  pub.interaction = null;
  pub.recentEffects = v.effects.map((e) => ({ ...e }));
  if (room.status === "finished") {
    pub.result = {
      endReason: v.endReason,
      winnerPlayerId: v.winnerPlayerId ?? null,
    };
    pub.room.memberFacingExpiresAt = room.memberFacingExpiry!.deadline;
    legalActions.push({ type: "room.leave" });
  } else if (
    phase.kind === "awaitingTurnAction" &&
    phase.actorId === playerId
  ) {
    const opportunityId = phase.opportunityId;
    legalActions.push({ type: "game.takeSouls", opportunityId });
    if (me.souls >= 1)
      legalActions.push({ type: "game.conspire", opportunityId });
    if (me.souls >= 8)
      legalActions.push({
        type: "game.forceRandomDiscard",
        opportunityId,
        eligiblePlayerIds: active(room)
          .filter((p) => p !== me && p.hand.length)
          .map((p) => p.playerId),
      });
    legalActions.push({
      type: "game.declareSin",
      opportunityId,
      allowedSins: SINS.filter((s) => COSTS[s] <= me.souls),
    });
  } else if (
    phase.kind === "awaitingChallenge" ||
    phase.kind === "awaitingCounter"
  ) {
    pub.interaction = {
      kind: phase.kind === "awaitingChallenge" ? "challenge" : "counter",
      interactionId: phase.interactionId,
      actorPlayerId: q!.actorId,
      declaredSin: q!.sin ?? v.stack.at(-1)!.effect,
      currentResponderId: phase.responderId,
      passedPlayerIds: q!.passed,
      deadline: phase.deadline,
      ...(phase.kind === "awaitingCounter"
        ? { cost: q!.cost, targetPlayerId: q!.targetId ?? null }
        : {}),
    };
    if (phase.responderId === playerId) {
      legalActions.push(
        {
          type:
            phase.kind === "awaitingChallenge"
              ? "game.challenge"
              : "game.payCounter",
          interactionId: phase.interactionId,
        },
        {
          type:
            phase.kind === "awaitingChallenge"
              ? "game.passChallenge"
              : "game.passCounter",
          interactionId: phase.interactionId,
        },
      );
    }
  } else if (phase.kind === "awaitingPrompt") {
    pub.interaction = {
      kind: "prompt",
      promptKind: q!.kind,
      playerId: phase.playerId,
      deadline: phase.deadline,
    };
    if (phase.playerId === playerId) {
      const card =
        q!.answerKind === "selectCard" || q!.answerKind === "selectCards";
      self.prompt = {
        kind: q!.answerKind,
        promptId: phase.promptId,
        purpose: q!.kind,
        deadline: phase.deadline,
        count: q!.count,
        ordered: q!.ordered,
        ...(card
          ? {
              eligibleHandCardRefs: q!.options!.map((id) =>
                env.handRef(room, me, v.cards[id]),
              ),
            }
          : q!.answerKind === "selectPlayer"
            ? { eligiblePlayerIds: q!.options }
            : { options: q!.options }),
      };
      legalActions.push({
        type: "game.answerPrompt",
        promptId: phase.promptId,
      });
    }
  } else if (phase.kind === "awaitingSimultaneousCards") {
    pub.interaction = {
      kind: "simultaneousCards",
      direction: q!.direction,
      deadline: phase.deadline,
    };
    if (q!.participants!.includes(playerId)) {
      const submitted =
        me.hand.length === 1 || sealed.some((s) => s.playerId === playerId);
      self.prompt = {
        kind: "selectHerejiaCard",
        promptId: phase.promptId,
        purpose: "herejiaCards",
        deadline: phase.deadline,
        submitted,
        eligibleHandCardRefs: submitted
          ? []
          : self.hand.map((c: any) => c.handCardRef),
      };
      if (!submitted)
        legalActions.push({
          type: "game.answerPrompt",
          promptId: phase.promptId,
        });
    }
  }
  return {
    ...base,
    rulesetId: v.rulesetId,
    matchConfigurationHash: v.configurationHash,
    public: pub,
    self,
  };
}
function publicCard(r: Room, id: string, env: Environment) {
  const c = r.game!.cards[id];
  return {
    publicCardRef: env.publicRef(r, c),
    sin: c.definition,
    ...(c.exposedTurnNumber
      ? { exposedTurnNumber: c.exposedTurnNumber, reason: c.reason }
      : {}),
  };
}
export function directory(rooms: Room[]) {
  return rooms
    .filter(
      (r) =>
        r.status === "lobby" &&
        r.seats.filter((s) => s.kind === "human").length <
          1 + r.config.additionalHumanPlayers,
    )
    .map((r) => ({
      roomId: r.roomId,
      visibility: r.visibility,
      hostDisplayName:
        r.seats.find((s) => s.playerId === r.hostPlayerId)?.displayName ?? null,
      occupiedHumanSeats: r.seats.filter((s) => s.kind === "human").length,
      configuredHumanSeats: 1 + r.config.additionalHumanPlayers,
      connectedHumanCount: r.seats.filter(
        (s) => s.kind === "human" && s.connected,
      ).length,
      botCount: r.config.botPlayers,
      createdAt: r.createdAt,
      status: "lobby",
      emptyLobbyExpiresAt: r.emptyLobbyExpiry?.deadline ?? null,
    }));
}
