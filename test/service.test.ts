import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GameService } from "../server/application/service.js";
import { MemoryRepository } from "../server/persistence/repository.js";
import { security } from "./helpers.js";
import { instant, plus } from "../server/domain/model.js";
import { commandSchema } from "../shared/protocol/schema.js";
async function setup() {
  let at = instant(1770000000000);
  const repo = new MemoryRepository(),
    service = new GameService(
      repo,
      security,
      security.environment(() => at),
      false,
    );
  await service.initialize();
  const users = [];
  for (let i = 0; i < 3; i++) {
    const { session, credential } = await service.authenticate(undefined, at);
    const { leaseId } = await service.acquire(session.digest, at, () => true);
    users.push({ digest: session.digest, leaseId, credential });
  }
  const run = (
    who: number,
    type: string,
    payload: any = {},
    overrides: any = {},
  ) => {
    const v = service.snapshot(users[who].digest),
      cmd = {
        protocolVersion: 1 as const,
        kind: "command" as const,
        commandId: randomUUID(),
        type,
        payload,
        ...(!["room.create", "room.joinPrivate", "room.joinPublic"].includes(
          type,
        )
          ? { roomId: v?.roomId, expectedStateVersion: v?.stateVersion }
          : {}),
        ...overrides,
      };
    return service.processCommand(
      users[who].digest,
      users[who].leaseId,
      cmd,
      at,
    );
  };
  return {
    repo,
    service,
    users,
    run,
    now: () => at,
    advance: (ms: number) => (at = plus(at, ms)),
  };
}
test("database ownership loss stops already queued work and suppresses publication", async () => {
  const f = await setup();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = f.service.enqueue(async () => {
    await gate;
  });
  let ran = false;
  const next = f.service.enqueue(async () => {
    ran = true;
  });
  const rejected = assert.rejects(next, /UNAVAILABLE/);
  f.service.fatal();
  release();
  await Promise.allSettled([first, rejected]);
  assert.equal(ran, false);
  await assert.rejects(
    f.service.publication(() => {
      ran = true;
    }),
    /UNAVAILABLE/,
  );
  assert.equal(ran, false);
  assert.equal(f.service.ready, false);
  await f.service.close();
});
test("a publication failure after commit retains the committed state and fails closed", async () => {
  const f = await setup();
  f.repo.publish = async () => {
    throw new Error("Server fence lost");
  };
  await assert.rejects(
    f.run(0, "room.create", {
      displayName: "Ana",
      visibility: "private",
      additionalHumanPlayers: 0,
      botPlayers: 2,
    }),
    /Server fence lost/,
  );
  assert.equal(f.service.ready, false);
  const saved = await f.repo.load("room");
  assert.equal(saved.length, 1);
  assert.deepEqual([...f.service.rooms.values()], saved);
  await f.service.close();
});
test("a reconnect closed during database work cannot replace the current lease", async () => {
  const f = await setup(),
    user = f.users[0];
  let open = true;
  const commit = f.repo.commit.bind(f.repo);
  f.repo.commit = async (writes, receipt, beforeCommit) => {
    open = false;
    await commit(writes, receipt, beforeCommit);
  };
  await assert.rejects(
    f.service.acquire(user.digest, f.now(), () => open),
    /CONNECTION_CLOSED/,
  );
  assert.equal(f.service.sessions.get(user.digest)?.lease?.id, user.leaseId);
  const saved = (await f.repo.load("session")).find(
    (s) => s.digest === user.digest,
  );
  assert.equal(saved.lease.id, user.leaseId);
  await f.service.close();
});
test("room commands persist, replay exactly, reject reused IDs and enforce single membership", async () => {
  const f = await setup(),
    commandId = randomUUID(),
    payload = {
      displayName: "Ana",
      visibility: "private",
      additionalHumanPlayers: 0,
      botPlayers: 2,
    };
  const first = await f.run(0, "room.create", payload, { commandId }),
    again = await f.run(0, "room.create", payload, { commandId });
  assert.equal(first.status, "accepted");
  assert.equal(again.replayed, true);
  assert.equal(first.data.privateCode, again.data.privateCode);
  assert.equal(f.service.rooms.size, 1);
  await assert.rejects(
    f.run(0, "room.create", { ...payload, botPlayers: 3 }, { commandId }),
    /COMMAND_ID_REUSED/,
  );
  assert.equal(
    (await f.run(0, "room.create", payload)).code,
    "ALREADY_IN_ROOM",
  );
  await f.service.close();
});
test("private room directory hides codes, code-only joins work, and full rooms disappear", async () => {
  const f = await setup();
  await f.run(0, "room.create", {
    displayName: "Ana",
    visibility: "private",
    additionalHumanPlayers: 1,
    botPlayers: 1,
  });
  const code = f.service.snapshot(f.users[0].digest).self.privateCode;
  assert.match(code, /^\d{6}$/);
  const [listed] = f.service.list();
  assert.equal(listed.visibility, "private");
  assert.equal(listed.hostDisplayName, "Ana");
  assert.deepEqual(Object.keys(listed), [
    "roomId", "visibility", "hostDisplayName", "occupiedHumanSeats",
    "configuredHumanSeats", "connectedHumanCount", "botCount", "createdAt",
    "status", "emptyLobbyExpiresAt",
  ]);
  assert.equal(
    (await f.run(1, "room.joinPrivate", { displayName: "Bruno", code })).status,
    "accepted",
  );
  assert.equal(f.service.list().length, 0);
  assert.equal(
    (await f.run(2, "room.joinPrivate", { displayName: "Carla", code })).code,
    "ROOM_NOT_FOUND_OR_UNAVAILABLE",
  );
  await f.service.close();
});
test("directory lists available public and private lobbies and follows vacancies, visibility, closure, and expiry", async () => {
  const f = await setup();
  const publicRoom = await f.run(0, "room.create", {
    displayName: "Ana",
    visibility: "public",
    additionalHumanPlayers: 1,
    botPlayers: 1,
  });
  const privateRoom = await f.run(1, "room.create", {
    displayName: "Bruno",
    visibility: "private",
    additionalHumanPlayers: 1,
    botPlayers: 1,
  });
  assert.deepEqual(
    f.service.list().map((r) => [r.roomId, r.visibility]),
    [[publicRoom.data.roomId, "public"], [privateRoom.data.roomId, "private"]],
  );
  assert.equal((await f.run(2, "room.joinPublic", { displayName: "Carla" }, {
    roomId: publicRoom.data.roomId,
  })).status, "accepted");
  assert.deepEqual(f.service.list().map((r) => r.roomId), [privateRoom.data.roomId]);
  await f.run(2, "room.leave");
  assert.equal(f.service.list().length, 2);
  await f.run(0, "room.configure", { visibility: "private" });
  assert(f.service.list().every((r) => r.visibility === "private"));
  await f.run(0, "room.configure", { visibility: "public" });
  assert.equal(f.service.list()[0].visibility, "public");
  await f.run(1, "room.leave");
  assert.deepEqual(f.service.list().map((r) => r.roomId), [publicRoom.data.roomId]);
  await f.service.disconnect(f.users[0].digest, f.users[0].leaseId, f.now());
  assert.equal(f.service.list()[0].connectedHumanCount, 0);
  assert(f.service.list()[0].emptyLobbyExpiresAt);
  f.advance(1800000);
  await f.service.drain(publicRoom.data.roomId, f.now());
  assert.deepEqual(f.service.list(), []);
  await f.service.close();
});
test("selected private joins require that table's code and bind replay to the selected id", async () => {
  const f = await setup();
  const created = [];
  for (const who of [0, 1]) {
    created.push(await f.run(who, "room.create", {
      displayName: `Host ${who}`,
      visibility: "private",
      additionalHumanPlayers: 1,
      botPlayers: 1,
    }));
  }
  const [first, second] = created;
  for (const [roomId, code] of [
    [first.data.roomId, second.data.privateCode],
    [randomUUID(), first.data.privateCode],
  ]) {
    const result = await f.run(2, "room.joinPrivate", { displayName: "Carla", code }, { roomId });
    assert.equal(result.code, "ROOM_NOT_FOUND_OR_UNAVAILABLE");
    assert.equal(f.service.sessions.get(f.users[2].digest)?.binding, undefined);
  }
  const commandId = randomUUID();
  const payload = { displayName: "Carla", code: first.data.privateCode };
  const accepted = await f.run(2, "room.joinPrivate", payload, { roomId: first.data.roomId, commandId });
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.data.roomId, first.data.roomId);
  const replay = await f.run(2, "room.joinPrivate", payload, { roomId: first.data.roomId, commandId });
  assert.equal(replay.replayed, true);
  assert.equal(f.service.rooms.get(first.data.roomId)!.seats.filter((s) => s.kind === "human").length, 2);
  await assert.rejects(
    f.run(2, "room.joinPrivate", payload, { roomId: second.data.roomId, commandId }),
    /COMMAND_ID_REUSED/,
  );
  await f.service.close();
});
test("selected private joins drain the selected lobby at its expiry boundary", async () => {
  for (const elapsed of [1799999, 1800000]) {
    const f = await setup();
    const created = await f.run(0, "room.create", {
      displayName: "Ana",
      visibility: "private",
      additionalHumanPlayers: 1,
      botPlayers: 1,
    });
    await f.service.disconnect(f.users[0].digest, f.users[0].leaseId, f.now());
    f.advance(elapsed);
    const result = await f.run(1, "room.joinPrivate", {
      displayName: "Bruno",
      code: created.data.privateCode,
    }, { roomId: created.data.roomId });
    if (elapsed < 1800000) {
      assert.equal(result.status, "accepted");
      assert.equal(f.service.rooms.get(created.data.roomId)!.emptyLobbyExpiry, undefined);
    } else {
      assert.equal(result.code, "ROOM_NOT_FOUND_OR_UNAVAILABLE");
      assert.equal(f.service.rooms.get(created.data.roomId)!.status, "closed");
    }
    assert.equal(f.service.list().length, 0);
    await f.service.close();
  }
});
test("concurrent selected private joins cannot claim the same final human seat", async () => {
  const f = await setup();
  const created = await f.run(0, "room.create", {
    displayName: "Ana",
    visibility: "private",
    additionalHumanPlayers: 1,
    botPlayers: 1,
  });
  const results = await Promise.all([1, 2].map((who) => f.service.enqueue(() =>
    f.run(who, "room.joinPrivate", {
      displayName: `Guest ${who}`,
      code: created.data.privateCode,
    }, { roomId: created.data.roomId }),
  )));
  assert.deepEqual(results.map((r) => r.status), ["accepted", "rejected"]);
  assert.equal(results[1].code, "ROOM_NOT_FOUND_OR_UNAVAILABLE");
  assert.equal(f.service.rooms.get(created.data.roomId)!.seats.filter((s) => s.kind === "human").length, 2);
  assert.equal(f.service.list().length, 0);
  await f.service.close();
});
test("readiness survives disconnect/reconnect; equal configure is version-preserving", async () => {
  const f = await setup();
  await f.run(0, "room.create", {
    displayName: "Ana",
    visibility: "private",
    additionalHumanPlayers: 1,
    botPlayers: 1,
  });
  const code = f.service.snapshot(f.users[0].digest).self.privateCode;
  await f.run(1, "room.joinPrivate", { displayName: "Bruno", code });
  await f.run(0, "room.setReady", { ready: true });
  await f.run(1, "room.setReady", { ready: true });
  await f.service.disconnect(f.users[1].digest, f.users[1].leaseId, f.now());
  let v = f.service.snapshot(f.users[0].digest);
  assert.equal(v.public.players[1].ready, true);
  const version = v.stateVersion;
  const result = await f.run(0, "room.configure", { botPlayers: 1 });
  assert.equal(result.appliedStateVersion, undefined);
  assert.equal(f.service.snapshot(f.users[0].digest).stateVersion, version);
  assert.equal((await f.run(0, "room.start")).status, "accepted");
  assert.equal(
    f.service.snapshot(f.users[0].digest).public.room.status,
    "active",
  );
  assert.equal(f.service.list().length, 0);
  await f.service.close();
});
test("actual config mutation clears non-host readiness and preserves host readiness", async () => {
  const f = await setup();
  await f.run(0, "room.create", {
    displayName: "Ana",
    visibility: "private",
    additionalHumanPlayers: 1,
    botPlayers: 1,
  });
  await f.run(1, "room.joinPrivate", {
    displayName: "B",
    code: f.service.snapshot(f.users[0].digest).self.privateCode,
  });
  await f.run(0, "room.setReady", { ready: true });
  await f.run(1, "room.setReady", { ready: true });
  await f.run(0, "room.configure", { visibility: "public" });
  const v = f.service.snapshot(f.users[0].digest);
  assert.equal(v.public.players[0].ready, true);
  assert.equal(v.public.players[1].ready, false);
  assert.equal(v.self.privateCode, undefined);
  assert.equal(f.service.list().length, 0);
  await f.service.close();
});
test("superseded lease neither changes state nor claims a receipt or disconnects replacement", async () => {
  const f = await setup();
  await f.run(0, "room.create", {
    displayName: "A",
    visibility: "private",
    additionalHumanPlayers: 0,
    botPlayers: 2,
  });
  const old = f.users[0].leaseId,
    newLease = await f.service.acquire(f.users[0].digest, f.now(), () => true),
    cmdId = randomUUID();
  await assert.rejects(
    f.run(0, "room.setReady", { ready: true }, { commandId: cmdId }),
    /CONNECTION_SUPERSEDED/,
  );
  assert.equal(await f.repo.receipt(f.users[0].digest, cmdId), undefined);
  await f.service.disconnect(f.users[0].digest, old, f.now());
  assert.equal(
    f.service.snapshot(f.users[0].digest).public.players[0].connected,
    true,
  );
  f.users[0].leaseId = newLease.leaseId;
  assert.equal(
    (await f.run(0, "room.setReady", { ready: true }, { commandId: cmdId }))
      .status,
    "accepted",
  );
  await f.service.close();
});
test("host grace transfers to longest-present connected human at exact boundary", async () => {
  const f = await setup();
  await f.run(0, "room.create", {
    displayName: "A",
    visibility: "private",
    additionalHumanPlayers: 2,
    botPlayers: 0,
  });
  const code = f.service.snapshot(f.users[0].digest).self.privateCode;
  await f.run(1, "room.joinPrivate", { displayName: "B", code });
  await f.run(2, "room.joinPrivate", { displayName: "C", code });
  const roomId = f.service.snapshot(f.users[0].digest).roomId;
  await f.service.disconnect(f.users[0].digest, f.users[0].leaseId, f.now());
  f.advance(60000);
  await f.service.drain(roomId, f.now());
  const v = f.service.snapshot(f.users[1].digest);
  assert.equal(v.public.lifecycle.hostPlayerId, v.self.playerId);
  await f.service.close();
});
test("empty lobby expiry releases membership and stale receipt cannot return code", async () => {
  const f = await setup(),
    commandId = randomUUID(),
    payload = {
      displayName: "A",
      visibility: "private",
      additionalHumanPlayers: 0,
      botPlayers: 2,
    };
  await f.run(0, "room.create", payload, { commandId });
  const r = [...f.service.rooms.values()][0];
  await f.service.disconnect(f.users[0].digest, f.users[0].leaseId, f.now());
  f.advance(1800000);
  await f.service.drain(r.roomId, f.now());
  assert.equal(f.service.rooms.get(r.roomId)!.status, "closed");
  assert.equal(f.service.sessions.get(f.users[0].digest)!.binding, undefined);
  f.users[0].leaseId = (
    await f.service.acquire(f.users[0].digest, f.now(), () => true)
  ).leaseId;
  const replay = await f.run(0, "room.create", payload, { commandId });
  assert.equal(replay.replayed, true);
  assert.equal(replay.data, undefined);
  await f.service.close();
});
test("recovery invalidates leases, preserves ready flag, and reconnects same seat", async () => {
  const f = await setup();
  await f.run(0, "room.create", {
    displayName: "A",
    visibility: "private",
    additionalHumanPlayers: 0,
    botPlayers: 2,
  });
  await f.run(0, "room.setReady", { ready: true });
  const before = f.service.snapshot(f.users[0].digest);
  const recovered = new GameService(
    f.repo,
    security,
    security.environment(f.now),
    false,
  );
  f.repo.epoch = randomUUID();
  await recovered.initialize();
  assert.equal(recovered.sessions.get(f.users[0].digest)!.lease, undefined);
  await recovered.acquire(f.users[0].digest, f.now(), () => true);
  const after = recovered.snapshot(f.users[0].digest);
  assert.equal(after.self.playerId, before.self.playerId);
  assert.equal(after.public.players[0].ready, true);
  assert.equal(after.public.players[0].connected, true);
  await recovered.close();
});
test("closed recursive wire schemas reject forged fields, identifiers and malformed prompts", () => {
  const base = {
    protocolVersion: 1,
    kind: "command",
    commandId: randomUUID(),
    type: "room.create",
    payload: {
      displayName: "Ana",
      visibility: "private",
      additionalHumanPlayers: 0,
      botPlayers: 2,
    },
  };
  assert(commandSchema.safeParse(base).success);
  for (const cmd of [
    { ...base, trustedReceivedAt: "x" },
    { ...base, expectedStateVersion: 1 },
    { ...base, payload: { ...base.payload, playerId: randomUUID() } },
    { ...base, commandId: "fake" },
  ])
    assert.equal(commandSchema.safeParse(cmd).success, false);
});
test("private join wire schema accepts a selected table or legacy code and validates both", () => {
  const command = {
    protocolVersion: 1,
    kind: "command",
    commandId: randomUUID(),
    type: "room.joinPrivate",
    payload: { displayName: "Ana", code: "004271" },
  };
  assert(commandSchema.safeParse(command).success);
  assert(commandSchema.safeParse({ ...command, roomId: randomUUID() }).success);
  for (const invalid of [
    { ...command, roomId: "fake" },
    { ...command, roomId: null },
    { ...command, payload: { displayName: "Ana" } },
    { ...command, payload: { ...command.payload, code: 4271 } },
    { ...command, payload: { ...command.payload, code: "4271" } },
    { ...command, payload: { ...command.payload, code: "abcdef" } },
    { ...command, payload: { ...command.payload, roomId: randomUUID() } },
    { ...command, expectedStateVersion: 1 },
  ]) assert.equal(commandSchema.safeParse(invalid).success, false);
});
