import test from "node:test";
import assert from "node:assert/strict";
import { Dispatcher } from "../public/games/insidia/commands/command-dispatcher.js";
import { fixture } from "./helpers.js";

function dispatcher(view: any) {
  let now = view?.public.turn?.deadline ? Date.parse(view.public.turn.deadline) - 10000 : Date.now();
  const sent: any[] = [];
  const store: any = {
    connected: true, reconnecting: false, view, rooms: [], pending: new Map(),
    error: null, commandFeedback: null, version: 0, now: () => now,
  };
  const dispatch = new Dispatcher(store, { send: (command: any) => { sent.push(command); return true; } });
  return { dispatch, store, sent, time: (value: number) => { now = value; } };
}

test("activation validates latest action identity and deadline, including equality", () => {
  const f = fixture(), d = dispatcher(f.view());
  const action = d.store.view.self.legalActions.find((entry: any) => entry.type === "game.takeSouls");
  assert.equal(d.dispatch.send("game.takeSouls", { opportunityId: crypto.randomUUID() }), false);
  assert.equal(d.store.commandFeedback.code, "STALE_STATE");
  d.time(Date.parse(d.store.view.public.turn.deadline));
  assert.equal(d.dispatch.send(action.type, { opportunityId: action.opportunityId }), false);
  assert.equal(d.store.commandFeedback.code, "DECISION_EXPIRED");
  assert.equal(d.sent.length, 0);
  d.time(Date.parse(d.store.view.public.turn.deadline) - 1);
  assert.equal(d.dispatch.send(action.type, { opportunityId: action.opportunityId }, undefined, "take-souls"), true);
  assert.equal(d.store.commandFeedback.origin, "take-souls");
  assert.equal(d.store.commandFeedback.status, "pending");
  assert.equal(d.sent.length, 1);
});

test("equivalent input activates once and retries the identical command after authority changes", () => {
  const f = fixture(), d = dispatcher(f.view());
  const action = d.store.view.self.legalActions.find((entry: any) => entry.type === "game.takeSouls");
  const payload = { opportunityId: action.opportunityId };
  assert.equal(d.dispatch.send(action.type, payload), true);
  assert.equal(d.dispatch.send(action.type, payload), false);
  const pending = [...d.store.pending.values()][0] as any;
  pending.sentAt = Date.now() - 6000;
  d.time(Date.parse(d.store.view.public.turn.deadline) + 1);
  d.store.view.self.legalActions = [];
  d.dispatch.retry();
  assert.equal(d.sent.length, 2);
  assert.equal(d.sent[1], d.sent[0]);
  assert.equal(d.sent[1].commandId, d.sent[0].commandId);
});

test("new authority rejects stale and ineligible claims without inspecting held sins", () => {
  const f = fixture();
  f.souls(0, 0);
  const d = dispatcher(f.view());
  const action = d.store.view.self.legalActions.find((entry: any) => entry.type === "game.declareSin");
  assert.equal(d.dispatch.send(action.type, { opportunityId: action.opportunityId, sin: "ORGULLO" }), false);
  const eligibleNotHeld = action.allowedSins.find((sin: string) => !d.store.view.self.hand.some((card: any) => card.sin === sin));
  assert.ok(eligibleNotHeld);
  assert.equal(d.dispatch.send(action.type, { opportunityId: action.opportunityId, sin: eligibleNotHeld }), true);
});

test("ordinary prompt options, count, and order are checked against current private authority", () => {
  const f = fixture();
  f.run("game.declareSin", { sin: "ENVIDIA" });
  f.pass();
  const d = dispatcher(f.view());
  const prompt = d.store.view.self.prompt;
  assert.equal(prompt.kind, "selectCards");
  d.time(Date.parse(prompt.deadline) - 1);
  const [first, second] = prompt.eligibleHandCardRefs;
  assert.equal(d.dispatch.send("game.answerPrompt", { promptId: prompt.promptId, answer: { kind: "selectCards", handCardRefs: [first, first] } }), false);
  assert.equal(d.dispatch.send("game.answerPrompt", { promptId: prompt.promptId, answer: { kind: "selectCards", handCardRefs: [first] } }), false);
  assert.equal(d.dispatch.send("game.answerPrompt", { promptId: crypto.randomUUID(), answer: { kind: "selectCards", handCardRefs: [second, first] } }), false);
  assert.equal(d.dispatch.send("game.answerPrompt", { promptId: prompt.promptId, answer: { kind: "selectCards", handCardRefs: [second, first] } }), true);
  assert.deepEqual(d.sent[0].payload.answer.handCardRefs, [second, first]);
  assert.equal(d.sent[0].expectedStateVersion, d.store.view.stateVersion);
});

test("Herejía uses issuer-only prompt authority, omits aggregate version, and rejects sealed resubmission", () => {
  const f = fixture();
  f.conspiracy("HEREJIA");
  f.run("game.conspire");
  f.answer({ kind: "selectDirection", direction: "left" });
  const d = dispatcher(f.view());
  const prompt = d.store.view.self.prompt;
  assert.equal(prompt.kind, "selectHerejiaCard");
  d.time(Date.parse(prompt.deadline) - 1);
  const payload = { promptId: prompt.promptId, answer: { kind: prompt.kind, handCardRef: prompt.eligibleHandCardRefs[0] } };
  assert.equal(d.dispatch.send("game.answerPrompt", payload), true);
  assert.equal("expectedStateVersion" in d.sent[0], false);
  d.store.pending.clear();
  prompt.submitted = true;
  assert.equal(d.dispatch.send("game.answerPrompt", payload), false);
  assert.equal(d.sent.length, 1);
});

test("room commands preserve their schema and do not depend on a gameplay deadline", () => {
  const d = dispatcher(null);
  const payload = { visibility: "private", displayName: "Ana", additionalHumanPlayers: 0, botPlayers: 2 };
  assert.equal(d.dispatch.send("room.create", { ...payload, botPlayers: 0 }), false);
  assert.equal(d.dispatch.send("room.create", payload), true);
  assert.equal("expectedStateVersion" in d.sent[0], false);
  assert.equal("roomId" in d.sent[0], false);
  d.store.pending.clear();
  const id = crypto.randomUUID();
  assert.equal(d.dispatch.send("room.joinPublic", { displayName: "Ana" }, id), true);
  assert.equal(d.sent[1].roomId, id);
  assert.equal("expectedStateVersion" in d.sent[1], false);
});

test("disconnected and reconnecting clients cannot commit", () => {
  const f = fixture(), d = dispatcher(f.view());
  const action = d.store.view.self.legalActions.find((entry: any) => entry.type === "game.takeSouls");
  d.store.connected = false;
  assert.equal(d.dispatch.send(action.type, { opportunityId: action.opportunityId }), false);
  d.store.connected = true;
  d.store.reconnecting = true;
  assert.equal(d.dispatch.send(action.type, { opportunityId: action.opportunityId }), false);
  assert.equal(d.sent.length, 0);
});
