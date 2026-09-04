import test from "node:test";
import assert from "node:assert/strict";
import { ClientStore } from "../public/games/insidia/state/client-store.js";
import { PresentationDirector } from "../public/games/insidia/presentation/presentation-director.js";
import { MOTION, ServerClock } from "../public/games/insidia/presentation/motion-tokens.js";
import { sanitizePublicEffect, planEffects } from "../public/games/insidia/presentation/effect-planner.js";
import { PresentationMetrics } from "../public/games/insidia/presentation/metrics.js";

const baseTime = Date.parse("2026-09-04T12:00:00.000Z");
const serialized = (value: any) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? String(item) : item);
function snapshot(revision: string | number = 1, effects: any[] = [], overrides: any = {}) {
  return {
    kind: "stateSnapshot", projectionEpoch: "epoch-a", projectionRevision: String(revision),
    roomId: "room-a", stateVersion: Number(revision), serverTime: new Date(baseTime).toISOString(),
    public: {
      room: { status: "active" },
      players: [{ playerId: "self", seatIndex: 0, displayName: "Yo", souls: 2, handCount: 2, faceUpSins: [] }],
      board: { soulBank: 54, sinDeckCount: 18, conspiracyDeckCount: 6, publicCenter: [], resolvingSin: null, revealedConspiracy: null },
      turn: { phase: "awaitingTurnAction", turnNumber: 1, activePlayerId: "other", deadline: new Date(baseTime + 60_000).toISOString() },
      interaction: null, recentEffects: effects,
    },
    self: { playerId: "self", hand: [{ handCardRef: "private-ref-a", sin: "GULA" }], legalActions: [], prompt: null, privateEffects: [] },
    ...overrides,
  };
}
function effect(seq: string | number, kind = "soulsGained", data: any = {}) {
  return { effectSeq: String(seq), stateVersion: 2, kind, actorPlayerId: "other", amount: 2, ...data };
}
function fixture() {
  let elapsed = 0, wall = baseTime;
  const storage = new Map<string, string>();
  const store = new ClientStore({
    now: () => elapsed, wallNow: () => wall,
    storage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) },
  });
  store.apply({ kind: "sessionReady", projectionEpoch: "epoch-a", serverTime: new Date(baseTime).toISOString() });
  return { store, presentation: store.presentation, storage,
    advance: (amount: number) => { elapsed += amount; store.presentation.update(); },
    wall: (value: number) => { wall = value; },
  };
}

test("each accepted projection is planned before the next frame, with numeric BigInt deduplication", () => {
  const { store, presentation } = fixture();
  const first = "9007199254740993";
  store.apply(snapshot(1, [effect(first)]));
  const proof = effect("9007199254740994", "claimProven", { sin: "GULA" });
  const exposure = effect("9007199254740995", "sinExposed", { sin: "RABIA", reason: "incorrectChallenge" });
  const next = snapshot(2, [proof, effect(first)]);
  store.apply(next);
  store.apply(snapshot(3, [exposure, effect(first), proof]));
  store.apply(snapshot(4, [proof, exposure, effect(first)], { stateVersion: 3 }));
  assert.equal(presentation.metrics.acceptedSnapshots, 4);
  assert.deepEqual(presentation.history.map((item: any) => item.effectSeq), [first, proof.effectSeq, exposure.effectSeq]);
  assert.equal(presentation.metrics.plannedCues, 2);
  assert.equal(presentation.presentedState.endpoint, store.view);
  assert.equal(store.apply(next), false);
  assert.equal(presentation.metrics.acceptedSnapshots, 4);
});

test("stale epochs, revisions, state versions and malformed revisions cannot change the clock", () => {
  const { store, advance, wall } = fixture();
  store.apply(snapshot(2));
  advance(100);
  const expected = store.now();
  const future = new Date(baseTime + 100_000).toISOString();
  for (const stale of [
    snapshot(3, [], { projectionEpoch: "old", serverTime: future }),
    snapshot(2, [], { serverTime: future }),
    snapshot(3, [], { stateVersion: 1, serverTime: future }),
    snapshot("broken", [], { stateVersion: 4, serverTime: future }),
  ]) assert.equal(store.apply(stale), false);
  wall(baseTime - 60_000);
  assert.equal(store.now(), expected);
  assert.equal(store.presentation.metrics.acceptedSnapshots, 1);
});

test("clock corrections use monotonic progression; cosmetic hold is unaffected", () => {
  let now = 0, wall = baseTime;
  const clock = new ServerClock(() => now, () => wall);
  clock.sample(new Date(baseTime).toISOString());
  now = 1000;
  wall += 100_000;
  assert.equal(clock.now(), baseTime + 1000);
  clock.sample(new Date(baseTime + 500).toISOString());
  const before = clock.now();
  now += 500;
  assert.equal(clock.now(), before + 250);
  clock.sample(new Date(baseTime + 20_000).toISOString());
  assert.equal(clock.now(), baseTime + 20_000);
});

test("equal-stateVersion Herejía acknowledgments replace current controls without public submission cues", () => {
  const { store, presentation } = fixture();
  const choosing = snapshot(1);
  choosing.self.prompt = { promptId: "private-prompt", kind: "selectHerejiaCard", submitted: false } as any;
  choosing.self.legalActions = [{ type: "game.answerPrompt", promptId: "private-prompt" }] as any;
  store.apply(choosing);
  const sealed = structuredClone(choosing);
  sealed.projectionRevision = "2";
  sealed.self.prompt!.submitted = true;
  sealed.self.legalActions = [];
  store.apply(sealed);
  assert.equal(store.view, sealed);
  assert.equal(presentation.presentedState.endpoint, sealed);
  assert.equal(presentation.cues.length, 0);
  assert.equal(presentation.history.length, 0);
  assert.equal(JSON.stringify(presentation.metrics).includes("private-prompt"), false);
});

test("two identical Conspiracies retain separate readable holds and live decisions never cancel them", () => {
  const { store, presentation, advance } = fixture();
  store.apply(snapshot(1));
  const a = effect(1, "conspiracyRevealed", { conspiracy: "HEREJIA" });
  const b = effect(2, "conspiracyRevealed", { conspiracy: "HEREJIA" });
  store.apply(snapshot(2, [a]));
  presentation.markRevealsReady();
  assert.equal(presentation.reveals[0].readableAt, MOTION.conspiracyEntrance);
  advance(500);
  const newer = snapshot(3, [a, b]);
  newer.public.board.revealedConspiracy = { conspiracy: "HEREJIA" } as any;
  newer.self.legalActions = [{ type: "game.answerPrompt", promptId: "decision-now" }] as any;
  store.apply(newer);
  presentation.markRevealsReady();
  assert.deepEqual(presentation.reveals.map((item: any) => item.key), ["1", "2"]);
  assert.deepEqual(presentation.reveals.map((item: any) => item.current), [false, true]);
  assert.equal(presentation.presentedState.endpoint, newer);
  advance(1349);
  assert.equal(presentation.reveals.length, 2);
  advance(1);
  assert.equal(presentation.reveals.length, 1);
  assert.equal(presentation.reveals[0].key, "2");
  advance(10_000);
  assert.equal(presentation.reveals[0].current, true);
  assert.equal(presentation.history.length, 2);
});

test("reduced motion persists immediately and keeps static Conspiracy visibility", () => {
  const { store, presentation, advance, storage } = fixture();
  presentation.setMotionPreference("reduced");
  assert.equal(storage.get("insidia.motion"), "reduced");
  store.apply(snapshot(1));
  store.apply(snapshot(2, [effect(1, "conspiracyRevealed", { conspiracy: "AGONIA" })]));
  presentation.markRevealsReady();
  assert.equal(presentation.reveals[0].progress, 1);
  advance(1499);
  assert.equal(presentation.reveals.length, 1);
  advance(1);
  assert.equal(presentation.reveals.length, 0);
});

test("third reveal overload and effect ring gaps preserve history and reconcile to received authority", () => {
  const { store, presentation } = fixture();
  store.apply(snapshot(1));
  const effects = [1, 2, 3].map((seq) => effect(seq, "conspiracyRevealed", { conspiracy: "SUPREMACIA" }));
  store.apply(snapshot(2, effects));
  assert.equal(presentation.reveals.length, 2);
  assert.equal(presentation.history.length, 3);
  assert.equal(presentation.notice, "Mesa actualizada");
  const afterGap = snapshot(3, [effect(80)]);
  store.apply(afterGap);
  assert.equal(presentation.cues.length, 0);
  assert.equal(presentation.metrics.historyGaps, 1);
  assert.equal(presentation.historyIncomplete, true);
  assert.equal(presentation.presentedState.endpoint, afterGap);
  assert.equal(presentation.history.at(-1).effectSeq, "80");
});

test("readable hold begins no earlier than its first submitted frame, even after a rendering stall", () => {
  const { store, presentation, advance } = fixture();
  presentation.setMotionPreference("reduced");
  store.apply(snapshot(1));
  store.apply(snapshot(2, [effect(1, "conspiracyRevealed", { conspiracy: "AGONIA" })]));
  advance(1900);
  assert.equal(presentation.reveals.length, 1);
  presentation.markRevealsReady();
  assert.equal(presentation.reveals[0].readableAt, 1900);
  assert.equal(presentation.reveals[0].expiresAt, 3400);
  advance(1000);
  presentation.markRevealsReady();
  assert.equal(presentation.reveals[0].expiresAt, 3400);
  advance(499);
  assert.equal(presentation.reveals.length, 1);
  advance(1);
  assert.equal(presentation.reveals.length, 0);
});

test("initial and reconnect snapshots seed old effects and show the current reveal immediately", () => {
  const { store, presentation } = fixture();
  const initial = snapshot(1, [effect(30, "conspiracyRevealed", { conspiracy: "APOSTASIA" })]);
  initial.public.board.revealedConspiracy = { conspiracy: "APOSTASIA" } as any;
  store.apply(initial);
  assert.equal(presentation.cues.length, 0);
  assert.equal(presentation.reveals[0].readableAt, 0);
  store.clearConnection();
  assert.deepEqual(store.view.self.hand, []);
  assert.deepEqual(store.view.self.legalActions, []);
  assert.equal(store.view.public.board, initial.public.board);
  assert.equal(presentation.presentedState.frozen, true);
  assert.equal(serialized(presentation).includes("private-ref-a"), false);
  store.apply({ kind: "sessionReady", projectionEpoch: "epoch-b", resumableRoomId: "room-a" });
  const resumed = snapshot(1, initial.public.recentEffects, { projectionEpoch: "epoch-b" });
  store.apply(resumed);
  assert.equal(store.view, resumed);
  assert.equal(presentation.cues.length, 0);
  assert.equal(presentation.history.length, 1);
  assert.equal(presentation.historyIncomplete, true);
});

test("hidden tab ingests history but return never plays stale choreography", () => {
  const { store, presentation, advance } = fixture();
  store.apply(snapshot(1));
  presentation.setHidden(true);
  store.apply(snapshot(2, [effect(1, "claimProven", { sin: "GULA" }), effect(2)]));
  advance(10_000);
  assert.equal(presentation.history.length, 2);
  assert.equal(presentation.cues.length, 0);
  presentation.setHidden(false);
  assert.equal(presentation.cues.length, 0);
  assert.equal(presentation.notice, "Mesa actualizada");
  assert.equal(presentation.presentedState.endpoint, store.view);
});

test("privacy allowlist excludes hidden identities and anonymous transfers never inherit definitions", () => {
  const hidden = { handCardRef: "secret-ref", cardId: "secret-id", sin: "ORGULLO", submittedPlayerIds: ["rival"], submissionCount: 1 };
  const safe = sanitizePublicEffect(effect(1, "cardsRotated", { direction: "left", ...hidden }));
  assert.deepEqual(safe, { effectSeq: "1", stateVersion: 2, kind: "cardsRotated", direction: "left" });
  const cues = planEffects(snapshot(), snapshot(2), [safe]);
  assert.equal(cues[0].permittedVisual.anonymous, true);
  assert.equal(cues[0].permittedVisual.face, "back");
  assert.equal(JSON.stringify(cues).includes("secret"), false);
  assert.equal(JSON.stringify(cues).includes("ORGULLO"), false);
  const truthful = sanitizePublicEffect(effect(2, "sinDeclared", { sin: "GULA", held: true }));
  const bluff = sanitizePublicEffect(effect(2, "sinDeclared", { sin: "GULA", held: false }));
  assert.deepEqual(planEffects(snapshot(), snapshot(2), [truthful]), planEffects(snapshot(), snapshot(2), [bluff]));
});

test("eliminations share one public beat and every batch endpoint is a received projection", () => {
  const { store, presentation } = fixture();
  store.apply(snapshot(1));
  const endpoint = snapshot(2, [
    effect(1, "playerEliminated", { actorPlayerId: "a", stateVersion: 2 }),
    effect(2, "playerEliminated", { actorPlayerId: "b", stateVersion: 2 }),
  ]);
  store.apply(endpoint);
  assert.equal(presentation.batches.length, 1);
  assert.equal(presentation.batches[0].endpoint, endpoint);
  assert.equal(presentation.batches[0].cues.length, 1);
  assert.deepEqual(presentation.batches[0].cues[0].permittedVisual.playerIds, ["a", "b"]);
});

test("separate cleanup versions remain separate groups within one received catch-up endpoint", () => {
  const previous = snapshot(1), endpoint = snapshot(4);
  const cues = planEffects(previous, endpoint, [
    effect(1, "playerEliminated", { actorPlayerId: "a", stateVersion: 2 }),
    effect(2, "playerEliminated", { actorPlayerId: "b", stateVersion: 2 }),
    effect(3, "playerEliminated", { actorPlayerId: "c", stateVersion: 4 }),
  ]);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues.map((cue: any) => cue.permittedVisual.playerIds), [["a", "b"], ["c"]]);
});

test("rotation uses observed prior active seats, including a player eliminated by subsequent cleanup", () => {
  const previous = snapshot(1), endpoint = snapshot(2);
  previous.public.players = ["a", "b", "c"].map((playerId, seatIndex) => ({
    playerId, seatIndex, status: "active", handCount: 1,
    faceUpSins: playerId === "b" ? [{ sin: "GULA" }, { sin: "RABIA" }] : [],
  })) as any;
  endpoint.public.players = structuredClone(previous.public.players);
  endpoint.public.players[1].status = "eliminated";
  const cues = planEffects(previous, endpoint, [effect(1, "cardsRotated", { direction: "right" })]);
  assert.equal(cues[0].permittedVisual.generic, false);
  assert.deepEqual(cues[0].permittedVisual.playerIds, ["a", "b", "c"]);
  const recovered = planEffects(previous, snapshot(5), [effect(1, "cardsRotated", { stateVersion: 3 })]);
  assert.equal(recovered[0].permittedVisual.generic, true);
  assert.equal(recovered[0].permittedVisual.playerIds, undefined);
  const forgiveness = planEffects(previous, endpoint, [effect(2, "sinForgiven", { actorPlayerId: "b" })]);
  assert.deepEqual(forgiveness[0].source, { zone: "exposure", playerId: "b" });
  assert.deepEqual(forgiveness[0].destination, { zone: "deck" });
});

test("observed Vanidad parent persists through the same-turn nested prompt and never crosses a lifecycle reset", () => {
  const { store, presentation } = fixture();
  store.apply(snapshot(1));
  const declaration = effect(1, "sinDeclared", { sin: "VANIDAD" });
  const claimed = snapshot(2, [declaration]);
  claimed.public.turn.phase = "awaitingChallenge";
  claimed.public.interaction = { declaredSin: "VANIDAD", actorPlayerId: "other" } as any;
  store.apply(claimed);
  const nested = snapshot(3, [declaration, effect(2, "conspiracyRevealed", { conspiracy: "HEREJIA" })]);
  nested.public.turn.phase = "awaitingPrompt";
  nested.public.board.revealedConspiracy = { conspiracy: "HEREJIA" } as any;
  store.apply(nested);
  assert.equal(presentation.claimContext.sin, "VANIDAD");
  assert.equal(presentation.claimContext.actorPlayerId, "other");
  store.clearConnection();
  assert.equal(presentation.claimContext, null);
  store.apply({ kind: "sessionReady", projectionEpoch: "epoch-b", resumableRoomId: "room-a" });
  const recovered = { ...nested, projectionEpoch: "epoch-b", projectionRevision: "1" };
  store.apply(recovered);
  assert.equal(presentation.claimContext, null, "retained effects cannot guess a parent on reconnect");
  const explicit = { ...claimed, projectionEpoch: "epoch-b", projectionRevision: "2", stateVersion: 4 };
  store.apply(explicit);
  assert.equal(presentation.claimContext.sin, "VANIDAD");
  const nextTurn = snapshot(5, [], { projectionEpoch: "epoch-b" });
  nextTurn.public.turn.turnNumber = 2;
  store.apply(nextTurn);
  assert.equal(presentation.claimContext, null);
});

test("bounded history and queue survive repeated room entry and exit, then teardown removes media listener", () => {
  const { store, presentation, advance } = fixture();
  store.apply(snapshot(1));
  for (let index = 1; index <= 220; index++) {
    store.apply(snapshot(index + 1, [effect(index)]));
    advance(1000);
  }
  assert.equal(presentation.history.length, 200);
  assert.equal(presentation.history[0].effectSeq, "21");
  assert.equal(presentation.timeline.tracks.length, 0);
  for (let index = 0; index < 20; index++) {
    store.apply({ kind: "roomMembershipEnded", roomId: store.view.roomId });
    store.apply(snapshot(222 + index, [effect(1)], { roomId: `room-${index}` }));
    assert.equal(presentation.history.length, 1);
    assert.equal(presentation.timeline.tracks.length, 0);
    assert.equal(presentation.batches.length, 0);
  }
  let added = 0, removed = 0;
  const director = new PresentationDirector({ matchMedia: () => ({ matches: false, addEventListener: () => added++, removeEventListener: () => removed++ }) });
  director.destroy();
  assert.equal(added, 1);
  assert.equal(removed, 1);
});

test("superseded session, fault, abandonment and membership changes clear private state and obsolete props", () => {
  const { store, presentation } = fixture();
  store.apply(snapshot(1));
  store.pending.set("command", { command: { payload: { handCardRef: "private-ref-a" } } });
  store.clearConnection({ superseded: true });
  assert.equal(store.view, null);
  assert.equal(store.pending.size, 0);
  assert.equal(presentation.history.length, 0);
  store.apply({ kind: "sessionReady", projectionEpoch: "epoch-b" });
  const abandoned = snapshot(2, [effect(1)], { projectionEpoch: "epoch-b" });
  abandoned.public.room.status = "finished";
  (abandoned.public as any).result = { endReason: "abandoned" };
  abandoned.self.legalActions = [{ type: "room.leave" }] as any;
  store.apply(abandoned);
  assert.deepEqual(store.view.self.hand, []);
  assert.equal(presentation.cues.length, 0);
  assert.equal(presentation.presentedState.frozen, true);
  const fault = snapshot(3, [], { projectionEpoch: "epoch-b", public: { room: { status: "faulted" }, integrityFault: { reference: "failure" } }, self: { legalActions: [{ type: "room.leave" }] } });
  store.apply(fault);
  assert.equal(presentation.history.length, 0);
  assert.equal(presentation.reveals.length, 0);
  assert.equal(serialized(presentation).includes("private-ref-a"), false);
  store.apply({ kind: "roomMembershipEnded", roomId: "room-a" });
  assert.equal(presentation.presentedState.endpoint, null);
});

test("receipts clear pending state and retain the originating action for inline rejection", () => {
  const { store } = fixture();
  store.pending.set("same-command", { origin: "declare:GULA", command: { type: "game.declareSin" } });
  store.apply({ kind: "commandResult", commandId: "same-command", status: "rejected", code: "STALE_STATE" });
  assert.equal(store.pending.size, 0);
  assert.equal(store.commandFeedback.origin, "declare:GULA");
  assert.equal(store.commandFeedback.code, "STALE_STATE");
  assert.equal(store.presentation.metrics.plannedCues, 0);
});

test("internal ring gaps reconcile and cross-turn outcomes are not given an invented action group", () => {
  const { store, presentation } = fixture();
  store.apply(snapshot(1));
  const next = snapshot(2, [effect(1), effect(3)]);
  next.public.turn.turnNumber = 2;
  store.apply(next);
  assert.equal(presentation.metrics.historyGaps, 1);
  assert.equal(presentation.cues.length, 0);
  assert.equal(presentation.history.every((item: any) => item.turnNumber === undefined), true);
  assert.equal(presentation.history.every((item: any) => item.groupLabel === "Actividad reciente"), true);
});

test("aggregate diagnostics bound numeric samples and measure only a new local decision", () => {
  const { store, presentation, advance } = fixture();
  const deciding = snapshot(1);
  deciding.self.legalActions = [{ type: "game.takeSouls", opportunityId: "choose" }] as any;
  store.apply(deciding);
  advance(16);
  presentation.markDecisionReady();
  presentation.markDecisionReady();
  const repeated = structuredClone(deciding);
  repeated.projectionRevision = "2";
  store.apply(repeated);
  presentation.markDecisionReady();
  assert.deepEqual(presentation.diagnostics.projectionToDecisionReadyMs,
    { count: 1, mean: 16, max: 16, p95: 16, p99: 16, windowSize: 1 });
  const metrics = new PresentationMetrics(4);
  for (let index = 1; index <= 100; index++) metrics.record("frameIntervalMs", index);
  metrics.record("handCardRef", 1);
  metrics.record("frameIntervalMs", NaN);
  const summary = metrics.summary();
  assert.equal(summary.frameIntervalMs.windowSize, 4);
  assert.equal(summary.frameIntervalMs.count, 100);
  assert.equal(summary.frameIntervalMs.p95, 100);
  assert.deepEqual(Object.keys(summary), ["frameIntervalMs"]);
  assert.equal(serialized(presentation.diagnostics).includes("choose"), false);
});
