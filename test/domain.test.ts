import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers.js";
import {
  validateRoom,
  timeout,
  cleanup,
  abandon,
  rotate,
  gameCommand,
} from "../server/domain/engine.js";
import { SINS, CONSPIRACIES } from "../shared/protocol/schema.js";
import { botCommand } from "../server/application/bot.js";
import { project } from "../server/projection/project.js";
import { hash } from "../server/security/crypto.js";

test("production manifest, round-robin deal and 60-soul conservation for 3–6 players", () => {
  for (let n = 3; n <= 6; n++) {
    const { room, env } = fixture(n);
    assert.equal(Object.keys(room.game!.cards).length, 30);
    assert.equal(room.game!.sinDeck.length, 24 - 2 * n);
    assert.equal(room.game!.bank, 60 - 2 * n);
    assert(room.seats.every((p) => p.hand.length === 2 && p.souls === 2));
    assert.equal(room.privateCode, undefined);
    validateRoom(room, env);
  }
});
test("unchallenged claim neither consumes nor inspects the claiming hand", () => {
  const f = fixture();
  const before = [...f.room.seats[0].hand];
  f.run("game.declareSin", { sin: "GULA" });
  f.pass();
  assert.deepEqual(f.room.seats[0].hand, before);
  assert.equal(f.room.seats[0].souls, 5);
});
test("a caught bluff exposes one random card and pays no base cost", () => {
  const f = fixture();
  f.souls(0, 10);
  const owned = f.room.seats[0].hand.map(
    (id) => f.room.game!.cards[id].definition,
  );
  const sin = SINS.find((s) => !owned.includes(s))!;
  f.run("game.declareSin", { sin });
  f.run("game.challenge");
  assert.equal(f.room.seats[0].souls, 10);
  assert.equal(f.room.seats[0].faceUpSins.length, 1);
  assert.equal(f.room.game!.turnNumber, 2);
});
test("truthful challenge holds card out, penalizes challenger, then returns/refills it", () => {
  const f = fixture();
  f.hand(0, "GULA");
  const held = f.room.seats[0].hand.find(
    (id) => f.room.game!.cards[id].definition === "GULA",
  )!;
  f.run("game.declareSin", { sin: "GULA" });
  f.run("game.challenge");
  assert.equal(f.room.seats[1].faceUpSins.length, 1);
  assert.equal(f.room.seats[0].hand.length, 2);
  assert.equal(f.room.game!.resolvingSin, undefined);
  assert(
    f.room.game!.sinDeck.includes(held) ||
      f.room.seats.some((p) => p.hand.includes(held)),
  );
});
test("Orgullo wins instantly after all counters pass, and blocking keeps both payments", () => {
  for (const blocked of [false, true]) {
    const f = fixture();
    f.souls(0, 9);
    f.souls(1, 8);
    f.run("game.declareSin", { sin: "ORGULLO" });
    f.pass();
    assert.equal(f.room.game!.phase.kind, "awaitingCounter");
    f.run(blocked ? "game.payCounter" : "game.passCounter");
    assert.equal(f.room.seats[0].souls, 0);
    assert.equal(f.room.status, blocked ? "active" : "finished");
    if (blocked) assert.equal(f.room.seats[1].souls, 0);
    else assert.equal(f.room.game!.winnerPlayerId, f.room.seats[0].playerId);
  }
});
test("Rabia chooses its target after challenge and lets the target choose exposure", () => {
  const f = fixture();
  f.souls(0, 4);
  f.souls(1, 0);
  f.souls(2, 0);
  f.run("game.declareSin", { sin: "RABIA" });
  f.pass();
  assert.equal(f.room.game!.pending!.kind, "rabiaTarget");
  f.answer({ kind: "selectPlayer", playerId: f.room.seats[2].playerId });
  const view = f.view(2);
  const chosen = view.self.hand[1];
  f.answer({ kind: "selectCard", handCardRef: chosen.handCardRef });
  assert.equal(f.view(2).public.players[2].faceUpSins[0].sin, chosen.sin);
});
test("Envidia preserves explicit bottom order", () => {
  const f = fixture();
  f.run("game.declareSin", { sin: "ENVIDIA" });
  f.pass();
  assert.equal(f.room.seats[0].hand.length, 4);
  const ids = f.room.seats[0].hand.slice(0, 2),
    refs = f
      .view()
      .self.hand.slice(0, 2)
      .map((c: any) => c.handCardRef);
  f.answer({ kind: "selectCards", handCardRefs: refs });
  assert.deepEqual(f.room.game!.sinDeck.slice(-2), ids);
});
test("Avaricia handles source shortage without negative balances", () => {
  const f = fixture();
  f.souls(1, 1);
  f.run("game.declareSin", { sin: "AVARICIA" });
  f.pass();
  f.answer({ kind: "selectPlayer", playerId: f.room.seats[1].playerId });
  assert.equal(f.room.seats[1].souls, 0);
  assert.equal(f.room.seats[0].souls, 3);
});
test("Lujuria persists target and permits returning the received card", () => {
  const f = fixture();
  f.run("game.declareSin", { sin: "LUJURIA" });
  f.pass();
  f.answer({ kind: "selectPlayer", playerId: f.room.seats[1].playerId });
  const id = f.room.seats[1].hand[0],
    oldRef = f.view(1).self.hand[0].handCardRef;
  f.answer({ kind: "selectCard", handCardRef: oldRef });
  assert.equal(f.room.game!.stack[0].receivedCardId, id);
  const received = f.view().self.hand.at(-1);
  assert.notEqual(received.handCardRef, oldRef);
  f.room.game = structuredClone(f.room.game);
  f.answer({ kind: "selectCard", handCardRef: received.handCardRef });
  assert(f.room.seats[1].hand.includes(id));
  assert.notEqual(
    f.view(1).self.hand.find((c: any) => c.sin === received.sin)?.handCardRef,
    oldRef,
  );
});
test("Pereza resets every active hand and returns the truthful held-out card", () => {
  const f = fixture();
  f.hand(0, "PEREZA");
  f.souls(1, 0);
  f.souls(2, 0);
  f.run("game.declareSin", { sin: "PEREZA" });
  f.run("game.challenge");
  assert(f.room.seats.every((p) => p.hand.length === 2));
  assert.equal(f.room.game!.resolvingSin, undefined);
});
for (const con of CONSPIRACIES)
  test(
    "Vanidad nests " + con + " without entry fee and returns conspiracy",
    () => {
      const f = fixture();
      f.souls(0, 0);
      f.conspiracy(con);
      f.run("game.declareSin", { sin: "VANIDAD" });
      f.pass();
      f.settle();
      assert.equal(f.room.game!.conspiracyDeck.length, 6);
      assert.equal(f.room.game!.revealedConspiracy, undefined);
      assert.equal(f.room.game!.stack.length, 0);
      validateRoom(f.room, f.env);
    },
  );
test("Herejía atomic right rotation preserves all slots and hand lengths", () => {
  const f = fixture(6);
  f.conspiracy("HEREJIA");
  f.run("game.conspire");
  f.answer({ kind: "selectDirection", direction: "right" });
  const before = f.room.seats.map((p) => [...p.hand]);
  const choices = Object.fromEntries(
    f.room.seats.map((p) => [p.playerId, p.hand[0]]),
  );
  rotate(f.room, choices, f.env);
  for (let i = 0; i < 6; i++) {
    assert.equal(f.room.seats[(i + 1) % 6].hand[0], before[i][0]);
    assert.equal(f.room.seats[i].hand[1], before[i][1]);
  }
});
test("cleanup eliminates simultaneously and uses correct next-actor/refill cursor", () => {
  const f = fixture(4),
    r = f.room;
  for (const index of [0, 2]) {
    const p = r.seats[index];
    p.faceUpSins.push(...p.hand);
    p.hand = [];
  }
  cleanup(r, f.env);
  assert.equal(r.seats[0].status, "eliminated");
  assert.equal(r.seats[2].status, "eliminated");
  assert.equal(r.game!.activeSeatIndex, 1);
  assert.equal(r.game!.publicCenter.length, 4);
  validateRoom(r, f.env);
});
test("zero survivors is a draw", () => {
  const f = fixture();
  for (const p of f.room.seats) {
    p.faceUpSins = p.hand;
    p.hand = [];
  }
  cleanup(f.room, f.env);
  assert.equal(f.room.game!.endReason, "draw");
  assert.equal(f.room.game!.winnerPlayerId, undefined);
});
test("abandonment freezes partially resolved Envidia without drawing or returning cards", () => {
  const f = fixture();
  f.run("game.declareSin", { sin: "ENVIDIA" });
  f.pass();
  const before = structuredClone(f.room.game!);
  abandon(f.room, f.env);
  assert.deepEqual(f.room.game!.cards, before.cards);
  assert.deepEqual(f.room.game!.sinDeck, before.sinDeck);
  assert.deepEqual(f.room.game!.stack, before.stack);
  assert.equal(f.room.seats[0].hand.length, 4);
  assert.equal(f.view().self.prompt, null);
  assert.deepEqual(f.view().self.legalActions, [{ type: "room.leave" }]);
});
test("corrupt card partition and soul balances fail closed", () => {
  for (const corruption of ["card", "souls"]) {
    const f = fixture();
    if (corruption === "card")
      f.room.game!.sinDeck.push(f.room.game!.sinDeck[0]);
    else f.room.game!.bank++;
    assert.throws(() => validateRoom(f.room, f.env));
  }
});
test("private projections contain no opponent card IDs, refs, deck order, or session digests", () => {
  const f = fixture(6);
  const v = f.view(),
    json = JSON.stringify(v);
  for (const p of f.room.seats) {
    assert(!json.includes(p.sessionDigest!));
    for (const id of p.hand) assert(!json.includes(id));
    if (p !== f.room.seats[0])
      for (const id of p.hand)
        assert(
          !json.includes(f.env.handRef(f.room, p, f.room.game!.cards[id])),
        );
  }
  for (const id of f.room.game!.sinDeck) assert(!json.includes(id));
  assert.equal(v.self.hand.length, 2);
  assert.equal(v.public.players[1].hand, undefined);
});
test("100 deterministic bot games finish legally across all seat counts", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const f = fixture(3 + (seed % 4), seed);
    let commands = 0;
    while (f.room.status === "active" && commands++ < 2000) {
      let acted = false;
      for (const p of f.room.seats) {
        const view = project(f.room, p.playerId, f.env);
        const cmd = botCommand(view, f.env.integer, f.env.id);
        if (!cmd) continue;
        const outcome = gameCommand(
          f.room,
          p.playerId,
          cmd,
          f.env,
          f.env.now(),
        );
        if (outcome.sealed) {
          timeout(f.room, f.env, [outcome.sealed]);
        }
        f.room.stateVersion++;
        validateRoom(f.room, f.env);
        acted = true;
        break;
      }
      assert(acted, "every phase offers at least one decision");
    }
    assert.equal(f.room.status, "finished", `seed ${seed} did not finish`);
    assert.equal(
      f.room.game!.bank + f.room.seats.reduce((n, p) => n + p.souls, 0),
      60,
    );
  }
});
