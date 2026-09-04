import { MOTION } from "./motion-tokens.js";

const EFFECT_FIELDS = Object.freeze({
  gameStarted: [],
  sinDeclared: ["actorPlayerId", "sin"],
  challengePassed: ["actorPlayerId"],
  claimChallenged: ["actorPlayerId", "targetPlayerId", "sin"],
  claimProven: ["actorPlayerId", "sin"],
  sinExposed: ["actorPlayerId", "sin", "reason"],
  soulsGained: ["actorPlayerId", "amount"],
  soulsPaid: ["actorPlayerId", "amount"],
  soulsStolen: ["actorPlayerId", "targetPlayerId", "amount"],
  conspiracyRevealed: ["actorPlayerId", "conspiracy"],
  playerEliminated: ["actorPlayerId"],
  cardTransferred: ["actorPlayerId", "targetPlayerId"],
  cardsExchanged: ["actorPlayerId", "amount"],
  cardsRotated: ["direction"],
  sinCountered: ["actorPlayerId", "sin"],
  handsShuffled: [],
  sinForgiven: ["actorPlayerId"],
  gameFinished: ["winnerPlayerId", "reason"],
  targetSelected: ["actorPlayerId", "targetPlayerId"],
});

export function effectSequence(effect) {
  return typeof effect?.effectSeq === "string" && /^\d+$/.test(effect.effectSeq)
    ? BigInt(effect.effectSeq) : null;
}

// Copy only the closed public v1 fields for each event. In particular, no
// privateEffects, hand reference, hidden identity, or sealed submission fact
// can reach cue payloads, history or diagnostics through a generic spread.
export function sanitizePublicEffect(effect) {
  if (!Object.hasOwn(EFFECT_FIELDS, effect?.kind) || effectSequence(effect) === null) return null;
  const result = {
    effectSeq: effect.effectSeq,
    stateVersion: effect.stateVersion,
    kind: effect.kind,
  };
  for (const field of EFFECT_FIELDS[effect.kind]) {
    const value = effect[field];
    if (field === "amount") {
      if (Number.isInteger(value) && value >= 0) result[field] = value;
    } else if (typeof value === "string") result[field] = value;
  }
  return Object.freeze(result);
}

const seat = (playerId) => Object.freeze({ zone: "seat", playerId });
const zone = (value) => Object.freeze({ zone: value });
const families = {
  gameStarted: ["exchangeAnonymousCards", 800, 180],
  sinDeclared: ["declareClaim", MOTION.claim, 180],
  challengePassed: ["advanceDecision", MOTION.pass, 80],
  claimChallenged: ["showChallenge", 200, 150],
  claimProven: ["showProof", MOTION.exposure, MOTION.proof],
  sinExposed: ["exposeSin", MOTION.exposure, 220],
  soulsGained: ["transferSouls", 550, 180],
  soulsPaid: ["transferSouls", 420, 180],
  soulsStolen: ["transferSouls", 550, 180],
  conspiracyRevealed: ["showConspiracy", MOTION.conspiracyEntrance, 180],
  playerEliminated: ["eliminateGroup", 850, 180],
  cardTransferred: ["exchangeAnonymousCards", MOTION.travel, 160],
  cardsExchanged: ["exchangeAnonymousCards", 650, 180],
  cardsRotated: ["rotateCards", 850, 180],
  sinCountered: ["blockClaim", 300, 150],
  handsShuffled: ["exchangeAnonymousCards", 850, 180],
  sinForgiven: ["exchangeAnonymousCards", 420, 180],
  gameFinished: ["showResult", MOTION.result, 180],
  targetSelected: ["advanceDecision", 180, 80],
};

export function planEffects(previous, projection, effects) {
  let predecessor = null;
  const cues = [];
  const eliminationGroups = new Map();
  for (const effect of effects) {
    if (effect.kind !== "playerEliminated") continue;
    if (!eliminationGroups.has(effect.stateVersion)) eliminationGroups.set(effect.stateVersion, []);
    eliminationGroups.get(effect.stateVersion).push(effect);
  }
  for (const effect of effects) {
    const eliminations = eliminationGroups.get(effect.stateVersion) ?? [];
    if (effect.kind === "playerEliminated" && effect.effectSeq !== eliminations[0]?.effectSeq) continue;
    const [kind, durationMs, beatMs] = families[effect.kind];
    const id = `${projection.roomId}:${projection.projectionEpoch}:effect:${effect.effectSeq}`;
    const permittedVisual = { ...effect };
    let source = seat(effect.actorPlayerId), destination = zone("stage");
    if (effect.kind === "soulsGained") {
      source = zone("bank"); destination = seat(effect.actorPlayerId);
    } else if (effect.kind === "soulsPaid") destination = zone("bank");
    else if (effect.kind === "soulsStolen") {
      source = seat(effect.targetPlayerId); destination = seat(effect.actorPlayerId);
    } else if (effect.kind === "cardTransferred") destination = seat(effect.targetPlayerId);
    else if (effect.kind === "sinExposed") destination = Object.freeze({ zone: "exposure", playerId: effect.actorPlayerId });
    else if (["cardsExchanged", "handsShuffled", "sinForgiven"].includes(effect.kind)) {
      destination = zone("deck");
      if (effect.kind === "sinForgiven") source = Object.freeze({ zone: "exposure", playerId: effect.actorPlayerId });
    }
    if (kind === "exchangeAnonymousCards" || kind === "rotateCards") {
      permittedVisual.face = "back";
      permittedVisual.anonymous = true;
    }
    if (kind === "eliminateGroup") {
      permittedVisual.playerIds = Object.freeze(eliminations.map((event) => event.actorPlayerId));
    }
    if (kind === "rotateCards" || effect.kind === "handsShuffled") {
      // Nested Vanidad can rotate a player who will be eliminated by the
      // cleanup in this same transaction. The newest survivor list therefore
      // cannot establish who participated. A consecutive, observed public
      // endpoint can; a recovered transition receives no invented roster.
      const observed = previous?.roomId === projection.roomId &&
        previous.projectionEpoch === projection.projectionEpoch &&
        previous.stateVersion + 1 === projection.stateVersion &&
        effect.stateVersion === projection.stateVersion;
      permittedVisual.generic = !observed;
      if (observed) permittedVisual.playerIds = Object.freeze(
        [...(previous.public.players ?? [])].filter((player) => player.status === "active")
          .sort((left, right) => left.seatIndex - right.seatIndex)
          .map((player) => player.playerId),
      );
    }
    cues.push(Object.freeze({
      id, kind, effect, durationMs, beatMs,
      after: Object.freeze(predecessor ? [predecessor] : []),
      priority: "consequence", source, destination,
      permittedVisual: Object.freeze(permittedVisual),
    }));
    predecessor = id;
  }
  // Projection-only changes carry no synthetic choice or sealed-state cue.
  // Current decisions are consumed directly from the newest authority.
  return Object.freeze(cues);
}

export function localDecisionKey(projection) {
  const actions = projection?.self?.legalActions?.filter((action) => action.type.startsWith("game.")) ?? [];
  if (!actions.length) return null;
  const action = actions[0];
  return `${projection.roomId}:${action.promptId ?? action.interactionId ?? action.opportunityId ?? ""}`;
}
