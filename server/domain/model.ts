import type { Sin, Conspiracy } from "../../shared/protocol/schema.js";
export type ID = string;
export interface Card {
  id: ID;
  family: "sin" | "conspiracy";
  definition: Sin | Conspiracy;
  epoch: number;
  exposedTurnNumber?: number;
  reason?: string;
}
export interface Seat {
  playerId: ID;
  sessionDigest?: string;
  seatIndex: number;
  joinedOrdinal: number;
  displayName: string;
  kind: "human" | "bot";
  ready: boolean;
  connected: boolean;
  membershipState: "bound" | "released" | "notApplicable";
  status: "active" | "eliminated";
  souls: number;
  hand: ID[];
  faceUpSins: ID[];
}
export type Phase =
  | {
      kind: "awaitingTurnAction";
      opportunityId: ID;
      actorId: ID;
      deadline: string;
    }
  | {
      kind: "awaitingChallenge" | "awaitingCounter";
      interactionId: ID;
      responderId: ID;
      deadline: string;
    }
  | { kind: "awaitingPrompt"; promptId: ID; playerId: ID; deadline: string }
  | { kind: "awaitingSimultaneousCards"; promptId: ID; deadline: string }
  | { kind: "finished" };
export interface Frame {
  kind: "sin" | "conspiracy";
  frameId: ID;
  actorId: ID;
  effect: Sin | Conspiracy;
  stage: string;
  targetId?: ID;
  receivedCardId?: ID;
  heldOutSinId?: ID;
  source?: "conspire" | "vanidad";
  conspiracyCardId?: ID;
}
export interface Pending {
  kind: string;
  ownerId?: ID;
  actorId?: ID;
  sin?: Sin;
  responders?: ID[];
  passed?: ID[];
  index?: number;
  cost?: number;
  targetId?: ID;
  options?: string[];
  answerKind?: string;
  count?: number;
  ordered?: boolean;
  direction?: "left" | "right";
  participants?: ID[];
}
export interface Effect {
  effectSeq: string;
  stateVersion: number;
  kind: string;
  actorPlayerId?: ID;
  targetPlayerId?: ID;
  sin?: Sin;
  conspiracy?: Conspiracy;
  amount?: number;
  reason?: string;
  winnerPlayerId?: ID;
  direction?: string;
}
export interface Configuration {
  rulesetId: "insidia-2.2-digital.1";
  engineVersion: 1;
  activeIntegrityValidatorVersion: "insidia-active-integrity.1";
  botPolicy: {
    id: "standard";
    version: 1;
    presentationDelayMinMs: number;
    presentationDelayMaxMs: number;
  };
  timersMs: {
    turnAction: number;
    challengeResponse: number;
    counterResponse: number;
    ordinaryPrompt: number;
    indigenciaChoice: number;
    allHumansDisconnected: number;
  };
  timeoutPolicyVersion: 1;
  manifest: {
    sinCopies: 3;
    totalSins: 24;
    totalSouls: 60;
    totalConspiracies: 6;
  };
}
export interface Game {
  gameId: ID;
  rulesetId: string;
  configuration: Configuration;
  configurationHash: string;
  cards: Record<ID, Card>;
  sinDeck: ID[];
  conspiracyDeck: ID[];
  publicCenter: { cardId: ID; formerOwnerId: ID }[];
  resolvingSin?: ID;
  revealedConspiracy?: ID;
  bank: number;
  activeSeatIndex: number;
  turnNumber: number;
  phase: Phase;
  stack: Frame[];
  pending?: Pending;
  effects: Effect[];
  nextEffectSeq: number;
  endReason?: "orgullo" | "last_survivor" | "draw" | "abandoned";
  winnerPlayerId?: ID;
  abandonedFromPhase?: Phase;
}
export interface Timer {
  timerId: ID;
  deadline: string;
}
export interface Room {
  roomId: ID;
  createdAt: string;
  visibility: "public" | "private";
  privateCode?: string;
  privateCodeGeneration: number;
  hostPlayerId: ID | null;
  hostGeneration: number;
  nextJoinedOrdinal: number;
  stateVersion: number;
  status: "lobby" | "active" | "finished" | "faulted" | "closed";
  config: {
    additionalHumanPlayers: number;
    botPlayers: number;
    totalPlayers: number;
  };
  lifecyclePolicy: {
    version: 1;
    hostGraceMs: number;
    emptyLobbyMs: number;
    memberFacingRetentionMs: number;
  };
  seats: Seat[];
  game?: Game;
  hostSuccession?: Timer & { state: "grace" | "awaitingConnectedSuccessor" };
  emptyLobbyExpiry?: Timer;
  allHumansDisconnected?: Timer;
  memberFacingExpiry?: Timer;
  integrityFault?: {
    reference: string;
    configurationHash: string;
    rulesetId: string;
  };
}
export interface Session {
  digest: string;
  createdAt: string;
  lastAuthenticatedAt: string;
  expiresAt: string;
  retainUntil?: string;
  generation: number;
  binding?: { roomId: ID; playerId: ID; generation: number };
  lease?: { id: ID; epoch: ID };
  retired?: boolean;
}
export interface Sealed {
  roomId: ID;
  promptId: ID;
  playerId: ID;
  cardId: ID;
  epoch: number;
  ordinal: string;
}
export interface Environment {
  now: () => string;
  id: () => ID;
  integer: (max: number) => number;
  hash: (value: unknown) => string;
  handRef: (room: Room, seat: Seat, card: Card) => string;
  publicRef: (room: Room, card: Card) => string;
}
export class RuleError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export class IntegrityError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export function demand(test: unknown, code: string): asserts test {
  if (!test) throw new RuleError(code);
}
export const instant = (ms: number) =>
  new Date(ms).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
export const micros = (s: string) =>
  BigInt(Date.parse(s.slice(0, 23) + "Z")) * 1000n + BigInt(s.slice(23, 26));
export const plus = (s: string, ms: number) =>
  instant(Number((micros(s) + BigInt(ms) * 1000n) / 1000n)).replace(
    /000Z$/,
    String((micros(s) + BigInt(ms) * 1000n) % 1000n).padStart(3, "0") + "Z",
  );
export const before = (a: string, b: string) => micros(a) < micros(b);
export const defaults: Configuration = {
  rulesetId: "insidia-2.2-digital.1",
  engineVersion: 1,
  activeIntegrityValidatorVersion: "insidia-active-integrity.1",
  botPolicy: {
    id: "standard",
    version: 1,
    presentationDelayMinMs: 400,
    presentationDelayMaxMs: 1200,
  },
  timersMs: {
    turnAction: 60000,
    challengeResponse: 15000,
    counterResponse: 15000,
    ordinaryPrompt: 30000,
    indigenciaChoice: 30000,
    allHumansDisconnected: 600000,
  },
  timeoutPolicyVersion: 1,
  manifest: {
    sinCopies: 3,
    totalSins: 24,
    totalSouls: 60,
    totalConspiracies: 6,
  },
};
export const active = (r: Room) => r.seats.filter((s) => s.status === "active");
export const seat = (r: Room, id: ID) => {
  const s = r.seats.find((p) => p.playerId === id);
  if (!s) throw new RuleError("INVALID_TARGET");
  return s;
};
