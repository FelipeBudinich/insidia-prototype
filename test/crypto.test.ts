import test from "node:test";
import assert from "node:assert/strict";
import { Security, canonical } from "../server/security/crypto.js";
import { fixture } from "./helpers.js";
import { micros, plus, instant } from "../server/domain/model.js";
test("AEAD rejects changed data, changed associated owner and wrong key", () => {
  const security = new Security(Buffer.alloc(32, 7)),
    blob = security.encrypt({ secret: "test" }, "snapshot:1");
  assert.deepEqual(security.decrypt(blob, "snapshot:1"), { secret: "test" });
  assert.throws(() => security.decrypt(blob, "snapshot:2"));
  assert.throws(() =>
    new Security(Buffer.alloc(32, 8)).decrypt(blob, "snapshot:1"),
  );
  assert.throws(() =>
    security.decrypt({ ...blob, tag: "x" + blob.tag.slice(1) }, "snapshot:1"),
  );
});
test("session credentials are 256-bit, canonical, and persistence contains only keyed digests", () => {
  const s = new Security(Buffer.alloc(32, 7));
  for (let i = 0; i < 50; i++) {
    const raw = s.newCredential();
    assert.equal(Buffer.from(raw.slice(5), "base64url").length, 32);
    assert.match(s.credentialDigest(raw)!, /^g1\.[\w-]{43}$/);
    assert.notEqual(s.credentialDigest(raw)?.slice(3), raw.slice(5));
  }
  assert.equal(s.credentialDigest("arbitrary token"), null);
});
test("card references rotate across visibility epochs, owners and games", () => {
  const f = fixture(),
    p = f.room.seats[0],
    c = f.room.game!.cards[p.hand[0]],
    old = f.env.handRef(f.room, p, c);
  assert.notEqual(old, f.env.handRef(f.room, f.room.seats[1], c));
  c.epoch++;
  assert.notEqual(old, f.env.handRef(f.room, p, c));
  assert.notEqual(f.env.publicRef(f.room, c), f.env.handRef(f.room, p, c));
});
test("microsecond timestamp comparison and addition preserve sub-millisecond precision", () => {
  const a = "2026-09-02T12:01:01.123456Z";
  assert.equal(plus(a, 1), "2026-09-02T12:01:01.124456Z");
  assert.equal(micros(plus(a, 1)) - micros(a), 1000n);
  assert.equal(instant(0), "1970-01-01T00:00:00.000000Z");
});
