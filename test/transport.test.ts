import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { GameService } from "../server/application/service.js";
import { MemoryRepository } from "../server/persistence/repository.js";
import { createHttp } from "../server/transport/http.js";
import { security } from "./helpers.js";
test("HTTP and WebSocket integration: sessions, closed protocol, 3 humans, private views, takeover", async () => {
  const service = new GameService(
    new MemoryRepository(),
    security,
    undefined,
    false,
  );
  await service.initialize();
  const http = createHttp(service, {
    production: true,
    origin: "http://localhost",
  });
  await new Promise<void>((r) => http.server.listen(0, "127.0.0.1", r));
  const address = http.server.address() as any,
    base = `http://127.0.0.1:${address.port}`,
    opened: WebSocket[] = [];
  try {
    for (const route of [
      "/tools/weltmeister.html",
      "/games/insidia/main.js",
      "/docs",
      "/api/state",
      "/server/index.ts",
    ])
      assert.equal((await fetch(base + route)).status, 404);
    assert.equal((await fetch(base + "/readyz")).status, 200);
    assert.equal(
      (
        await fetch(base + "/api/session", {
          method: "POST",
          headers: { Origin: "http://evil.example" },
        })
      ).status,
      403,
    );
    async function client(cookie?: string) {
      if (!cookie) {
        const response = await fetch(base + "/api/session", {
          method: "POST",
          headers: { Origin: "http://localhost" },
        });
        assert.equal(response.status, 200);
        const raw = response.headers.get("set-cookie")!;
        assert.match(raw, /HttpOnly/);
        assert.match(raw, /Secure/);
        assert.match(raw, /SameSite=Lax/);
        cookie = raw.split(";")[0];
      }
      const ws = new WebSocket(base.replace("http", "ws") + "/ws", {
        headers: { Origin: "http://localhost", Cookie: cookie },
      });
      opened.push(ws);
      const frames: any[] = [];
      let view: any;
      const listeners = new Map<string, (v: any) => void>();
      let readyResolve: () => void;
      const ready = new Promise<void>((r) => (readyResolve = r));
      ws.on("message", (data) => {
        const m = JSON.parse(data.toString());
        frames.push(m);
        if (m.kind === "serverHello")
          ws.send(JSON.stringify({ protocolVersion: 1, kind: "clientHello" }));
        if (m.kind === "sessionReady") readyResolve();
        if (m.kind === "stateSnapshot") view = m;
        if (m.kind === "commandResult") listeners.get(m.commandId)?.(m);
      });
      await ready;
      const sync = () =>
        new Promise<void>((resolve) => {
          const handler = (data: any) => {
            if (JSON.parse(data.toString()).kind === "stateSnapshot") {
              ws.off("message", handler);
              resolve();
            }
          };
          ws.on("message", handler);
          ws.send(
            JSON.stringify({ protocolVersion: 1, kind: "state.request" }),
          );
        });
      const send = async (type: string, payload: any = {}, extra: any = {}) => {
        if (
          !["room.create", "room.joinPrivate", "room.joinPublic"].includes(type)
        )
          await sync();
        return new Promise<any>((resolve) => {
          const commandId = randomUUID();
          listeners.set(commandId, resolve);
          const cmd = {
            protocolVersion: 1,
            kind: "command",
            commandId,
            type,
            payload,
            ...(![
              "room.create",
              "room.joinPrivate",
              "room.joinPublic",
            ].includes(type)
              ? { roomId: view.roomId, expectedStateVersion: view.stateVersion }
              : {}),
            ...extra,
          };
          ws.send(JSON.stringify(cmd));
        });
      };
      return { ws, cookie, frames, send, view: () => view };
    }
    const a = await client(),
      b = await client(),
      c = await client();
    const directory = (roomIds: string[]) =>
      new Promise<any[]>((resolve, reject) => {
        const timer = setTimeout(() => {
          c.ws.off("message", handler);
          reject(new Error("Expected directory snapshot did not arrive"));
        }, 2000);
        const handler = (data: any) => {
          const message = JSON.parse(data.toString());
          if (message.kind !== "roomListSnapshot") return;
          const listedIds = message.rooms.map((room: any) => room.roomId).sort();
          if (JSON.stringify(listedIds) !== JSON.stringify([...roomIds].sort())) return;
          clearTimeout(timer);
          c.ws.off("message", handler);
          resolve(message.rooms);
        };
        c.ws.on("message", handler);
        c.ws.send(JSON.stringify({ protocolVersion: 1, kind: "roomList.subscribe" }));
      });
    assert.deepEqual(await directory([]), []);
    const privateRoom = await a.send("room.create", {
      displayName: "Ana",
      visibility: "private",
      additionalHumanPlayers: 1,
      botPlayers: 1,
    });
    assert.equal(privateRoom.status, "accepted");
    const privateListing = await directory([privateRoom.data.roomId]);
    assert.equal(privateListing.length, 1);
    assert.equal(privateListing[0].roomId, privateRoom.data.roomId);
    assert.equal(privateListing[0].visibility, "private");
    assert.equal("privateCode" in privateListing[0], false);
    assert.equal((await b.send("room.joinPrivate", {
      displayName: "Bruno",
      code: privateRoom.data.privateCode,
    }, { roomId: randomUUID() })).code, "ROOM_NOT_FOUND_OR_UNAVAILABLE");
    assert.equal((await b.send("room.joinPrivate", {
      displayName: "Bruno",
      code: privateRoom.data.privateCode,
    }, { roomId: privateRoom.data.roomId })).status, "accepted");
    assert.deepEqual(await directory([]), []);
    await b.send("room.leave");
    assert.equal((await directory([privateRoom.data.roomId])).length, 1);
    await a.send("room.leave");
    assert.deepEqual(await directory([]), []);
    const created = await a.send("room.create", {
      displayName: "Ana",
      visibility: "public",
      additionalHumanPlayers: 2,
      botPlayers: 0,
    });
    assert.equal(created.status, "accepted");
    assert.equal((await directory([created.data.roomId]))[0].visibility, "public");
    await b.send(
      "room.joinPublic",
      { displayName: "Bruno" },
      { roomId: created.data.roomId },
    );
    await c.send(
      "room.joinPublic",
      { displayName: "Carla" },
      { roomId: created.data.roomId },
    );
    await a.send("room.setReady", { ready: true });
    await b.send("room.setReady", { ready: true });
    await c.send("room.setReady", { ready: true });
    const started = await a.send("room.start");
    assert.equal(started.status, "accepted");
    assert.deepEqual(await directory([]), []);
    // Flush network delivery through a request/response frame on each independent socket.
    for (const user of [a, b, c]) await user.send("room.leave");
    for (const user of [a, b, c]) {
      const v = user.view();
      assert.equal(v.public.room.status, "active");
      assert.equal(v.self.hand.length, 2);
      assert.equal(v.public.players.length, 3);
      assert(v.public.players.every((p: any) => !("hand" in p)));
      assert(!JSON.stringify(user.frames).includes("sessionDigest"));
      assert(!JSON.stringify(user.frames).includes('conspiracyDeck"'));
    }
    const handRefs = [a, b, c].flatMap((user) =>
      user.view().self.hand.map((card: any) => card.handCardRef),
    );
    assert.equal(new Set(handRefs).size, 6);
    const closeCode = new Promise<number>((resolve) =>
      a.ws.once("close", resolve),
    );
    const replacement = await client(a.cookie);
    assert.equal(await closeCode, 4409);
    await replacement.send("room.leave");
    assert.equal(replacement.view().self.playerId, a.view().self.playerId);
    assert.deepEqual(replacement.view().self.hand, a.view().self.hand);
  } finally {
    for (const ws of opened) ws.terminate();
    await http.close();
  }
});
