import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ClientStore } from "../public/games/insidia/state/client-store.js";
import { SINS, CONSPIRACIES } from "../shared/protocol/schema.js";

const fixtures = JSON.parse(await readFile(new URL("../tools/ux/fixtures.json", import.meta.url), "utf8"));

test("sanitized replay fixtures cover all Sins, Conspiracies, sensitive branches and terminal outcomes", () => {
  const sins = new Set<string>(), conspiracies = new Set<string>(), ids = new Set<string>();
  for (const sequence of fixtures.sequences) {
    ids.add(sequence.id);
    for (const { snapshot } of sequence.frames)
      for (const effect of snapshot.public.recentEffects) {
        if (effect.kind === "sinDeclared") sins.add(effect.sin);
        if (effect.kind === "conspiracyRevealed") conspiracies.add(effect.conspiracy);
      }
  }
  assert.deepEqual([...sins].sort(), [...SINS].sort());
  assert.deepEqual([...conspiracies].sort(), [...CONSPIRACIES].sort());
  for (const id of ["caught-bluff", "orgullo-blocked", "pereza-held-out", "lujuria-return-received", "abandon-envidia", "orgullo-win", "final-draw", "group-elimination", "history-gap"])
    assert.ok(ids.has(id), `missing ${id}`);
});

for (const motion of ["full", "reduced"])
  test(`all real fixture endpoints and privacy boundaries survive ${motion} motion replay`, () => {
    let accepted = 0;
    for (const sequence of fixtures.sequences) {
      let now = 0;
      const first = sequence.frames[0].snapshot;
      const store = new ClientStore({ now: () => now, wallNow: () => Date.parse(first.serverTime), storage: { getItem: () => motion, setItem() {} } });
      store.apply({ kind: "sessionReady", projectionEpoch: first.projectionEpoch, resumableRoomId: first.roomId, serverTime: first.serverTime });
      const ownRefs = new Set<string>(sequence.frames.flatMap(({ snapshot }: any) => snapshot.self.hand.map((card: any) => card.handCardRef)));
      for (const { snapshot } of sequence.frames) {
        now += 17;
        assert.equal(store.apply(structuredClone(snapshot)), true, sequence.id);
        accepted++;
        store.presentation.update();
        const endpoint = store.presentation.presentedState.endpoint;
        assert.deepEqual(endpoint.public, snapshot.public, `${sequence.id}: current public endpoint`);
        assert.equal(endpoint.stateVersion, snapshot.stateVersion);
        assert.equal(endpoint.projectionRevision, snapshot.projectionRevision);
        const abandoned = snapshot.public.result?.endReason === "abandoned";
        assert.deepEqual(endpoint.self.hand, abandoned ? [] : snapshot.self.hand, `${sequence.id}: authorized own hand`);
        assert.deepEqual(endpoint.self.prompt, abandoned ? null : snapshot.self.prompt, `${sequence.id}: latest prompt`);
        for (const player of endpoint.public.players) {
          assert.equal("hand" in player, false);
          assert.equal("eligibleHandCardRefs" in player, false);
          assert.equal("submitted" in player, false);
          assert.equal("submissionTime" in player, false);
        }
        const cosmetics = JSON.stringify({ cues: store.presentation.cues, reveals: store.presentation.reveals, history: store.presentation.history, diagnostics: store.presentation.diagnostics });
        for (const ref of ownRefs) assert.equal(cosmetics.includes(ref), false, `${sequence.id}: private ref in cosmetics`);
        for (const field of ["handCardRef", "handCardRefs", "cardInstanceId", "sessionDigest", "completionOrdinal", "submitted", "receivedCardId"])
          assert.equal(cosmetics.includes(`"${field}"`), false, `${sequence.id}: ${field} leaked into cosmetics`);
        store.presentation.markRevealsReady();
      }
      if (sequence.id === "history-gap") assert.equal(store.presentation.metrics.historyGaps, 1);
      now += 10000; store.presentation.update();
      assert.deepEqual(store.presentation.presentedState.endpoint.public, sequence.frames.at(-1).snapshot.public);
      store.presentation.destroy();
    }
    assert.equal(accepted, 101);
  });
