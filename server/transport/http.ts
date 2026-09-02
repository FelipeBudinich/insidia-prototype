import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { GameService } from "../application/service.js";
import {
  helloSchema,
  commandSchema,
  requestSchema,
  type Command,
} from "../../shared/protocol/schema.js";
import { RuleError } from "../domain/model.js";

class Limit {
  private entries = new Map<string, { n: number; at: number }>();
  allow(key: string, max: number, window = 60000) {
    const now = Date.now(),
      v = this.entries.get(key);
    if (!v || now - v.at > window) {
      this.entries.set(key, { n: 1, at: now });
      if (this.entries.size > 10000)
        for (const [k, v] of this.entries)
          if (now - v.at > window) this.entries.delete(k);
      return true;
    }
    return ++v.n <= max;
  }
}
type Controller = {
  ws: WebSocket;
  digest: string;
  leaseId: string;
  projectionEpoch: string;
  revision: bigint;
  subscribed: boolean;
  alive: boolean;
  activated: boolean;
  closed: boolean;
};
export function createHttp(
  service: GameService,
  options: { production: boolean; origin: string; root?: string },
) {
  const app = express(),
    server = createServer(app),
    wss = new WebSocketServer({
      noServer: true,
      maxPayload: 16384,
      perMessageDeflate: false,
    });
  const root = options.root ?? process.cwd(),
    controllers = new Map<string, Controller>(),
    limiter = new Limit();
  const originAllowed = (origin: string | undefined) =>
    origin === options.origin;
  const ip = (req: any) =>
    options.production
      ? String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress)
          .split(",")
          .at(-1)!
          .trim()
      : (req.socket.remoteAddress ?? "unknown");
  const cookie = (req: any) =>
    String(req.headers.cookie ?? "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("insidia_guest="))
      ?.slice(14);
  const send = (c: Controller, msg: any) => {
    if (
      service.ready &&
      !c.closed &&
      c.ws.readyState === WebSocket.OPEN &&
      (!c.activated || service.sessions.get(c.digest)?.lease?.id === c.leaseId)
    ) {
      if (c.ws.bufferedAmount > 1024 * 1024) {
        c.ws.close(4429, "BACKPRESSURE");
        return;
      }
      c.ws.send(JSON.stringify(msg));
    }
  };
  const snapshot = (c: Controller) => {
    if (!c.activated || c.closed) return;
    const view = service.snapshot(c.digest);
    if (view)
      send(c, {
        ...view,
        projectionEpoch: c.projectionEpoch,
        projectionRevision: String(c.revision++),
      });
  };
  const rejectLimited = (c: Controller, commandId: string) => {
    void service
      .enqueue(() =>
        service.publication(() =>
          send(c, {
            protocolVersion: 1,
            kind: "commandResult",
            commandId,
            status: "rejected",
            code: "RATE_LIMITED",
          }),
        ),
      )
      .catch(() => {});
  };
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    if (options.production)
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
  });
  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  app.get("/readyz", (_req, res) =>
    res
      .status(service.ready ? 200 : 503)
      .json({ status: service.ready ? "ready" : "unavailable" }),
  );
  app.post("/api/session", async (req, res) => {
    const at = service.env.now();
    if (!service.ready)
      return void res.status(503).json({ code: "UNAVAILABLE" });
    if (!originAllowed(req.headers.origin))
      return void res.status(403).json({ code: "ORIGIN_REJECTED" });
    if (!limiter.allow("session:" + ip(req), 30))
      return void res.status(429).json({ code: "RATE_LIMITED" });
    try {
      await service.enqueue(async () => {
        const result = await service.authenticate(cookie(req), at);
        await service.publication(() => {
          if (result.credential)
            res.setHeader(
              "Set-Cookie",
              `insidia_guest=${result.credential}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${options.production ? "; Secure" : ""}`,
            );
          else if (cookie(req))
            res.setHeader(
              "Set-Cookie",
              `insidia_guest=${cookie(req)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${options.production ? "; Secure" : ""}`,
            );
          res.setHeader("Cache-Control", "no-store");
          res.json({ protocolVersion: 1 });
        });
      });
    } catch {
      res.status(503).json({ code: "UNAVAILABLE" });
    }
  });
  const clientRoot = path.join(
    root,
    options.production ? "public/dist/insidia" : "public/games/insidia",
  );
  const index = (_req: any, res: any) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(clientRoot, "index.html"));
  };
  app.get("/", index);
  app.get("/dist/insidia/", index);
  if (options.production) {
    app.use(
      "/dist/insidia/assets",
      express.static(path.join(clientRoot, "assets"), {
        index: false,
        fallthrough: false,
        setHeaders(res, file) {
          res.setHeader(
            "Cache-Control",
            /[.-][A-Za-z0-9_-]{8,}\.(js|css|woff2|png|webp|svg)$/.test(file)
              ? "public,max-age=31536000,immutable"
              : "no-cache",
          );
        },
      }),
    );
  } else {
    app.use("/games/insidia", express.static(clientRoot, { index: false }));
    app.use(
      "/lib",
      express.static(path.join(root, "public/lib"), { index: false }),
    );
  }
  app.use((_req, res) => res.status(404).json({ code: "NOT_FOUND" }));
  app.use((err: any, _req: any, res: any, _next: any) =>
    res
      .status(err.status === 404 ? 404 : 500)
      .json({ code: err.status === 404 ? "NOT_FOUND" : "UNAVAILABLE" }),
  );
  server.on("upgrade", (req, socket, head) => {
    if (
      req.url !== "/ws" ||
      !service.ready ||
      !originAllowed(req.headers.origin) ||
      !limiter.allow("ws:" + ip(req), 40)
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const raw = cookie(req),
      digest = raw ? service.security.credentialDigest(raw) : null;
    if (!digest) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const at = service.env.now();
    let canceled = false;
    socket.once("close", () => {
      canceled = true;
    });
    void service
      .enqueue(async () => {
        const known = service.sessions.get(digest);
        if (canceled || !known || known.retired) {
          socket.destroy();
          return;
        }
        const auth = await service.authenticate(raw, at);
        if (auth.credential || canceled) {
          socket.destroy();
          return;
        }
        await service.publication(() => {
          if (canceled) return;
          wss.handleUpgrade(req, socket, head, (ws) => {
            const c: Controller = {
              ws,
              digest,
              leaseId: "",
              projectionEpoch: randomUUID(),
              revision: 1n,
              subscribed: false,
              alive: true,
              activated: false,
              closed: false,
            };
            let helloQueued = false;
            let closeQueued = false;
            const close = () => {
              if (c.closed) return;
              c.closed = true;
              if (helloQueued && !closeQueued) {
                closeQueued = true;
                const closeAt = service.env.now();
                void service
                  .enqueue(async () => {
                    if (c.leaseId)
                      await service.disconnect(digest, c.leaseId, closeAt);
                    if (controllers.get(digest) === c)
                      controllers.delete(digest);
                  })
                  .catch(() => {});
              }
            };
            const fail = (code: number, reason: string) => {
              close();
              ws.close(code, reason);
            };
            const handshakeTimeout = setTimeout(
              () => fail(4400, "HANDSHAKE_TIMEOUT"),
              10000,
            ).unref();
            ws.on("close", () => {
              clearTimeout(handshakeTimeout);
              close();
            });
            ws.on("error", close);
            ws.on("pong", () => {
              c.alive = true;
            });
            send(c, {
              protocolVersion: 1,
              kind: "serverHello",
              serverTime: service.env.now(),
              heartbeatMs: 20000,
            });
            ws.on("message", (bytes, isBinary) => {
              const receivedAt = service.env.now();
              if (c.closed) return;
              if (isBinary) {
                fail(4400, "HANDSHAKE_PROTOCOL_ERROR");
                return;
              }
              let msg: any;
              try {
                msg = JSON.parse(bytes.toString());
              } catch {
                fail(4400, "INVALID_JSON");
                return;
              }
              if (!c.activated) {
                if (helloQueued) {
                  fail(4400, "HANDSHAKE_PROTOCOL_ERROR");
                  return;
                }
                helloQueued = true;
                void service
                  .enqueue(async () => {
                    if (!helloSchema.safeParse(msg).success) {
                      fail(4400, "HANDSHAKE_PROTOCOL_ERROR");
                      return;
                    }
                    if (c.closed) return;
                    try {
                      const acquisition = await service.acquire(
                        digest,
                        receivedAt,
                        () => !c.closed,
                      );
                      c.leaseId = acquisition.leaseId;
                      await service.publication(() => {
                        const old = controllers.get(digest);
                        if (old && old !== c) {
                          old.ws.close(4409, "CONNECTION_SUPERSEDED");
                          old.closed = true;
                        }
                        if (c.closed) return;
                        controllers.set(digest, c);
                        c.activated = true;
                        clearTimeout(handshakeTimeout);
                        send(c, {
                          protocolVersion: 1,
                          kind: "sessionReady",
                          projectionEpoch: c.projectionEpoch,
                          serverTime: service.env.now(),
                          resumableRoomId:
                            service.sessions.get(digest)?.binding?.roomId ??
                            null,
                        });
                        snapshot(c);
                      });
                    } catch (e) {
                      fail(
                        e instanceof RuleError ? 4401 : 4500,
                        "AUTH_REQUIRED",
                      );
                    }
                  })
                  .catch(() => {});
                return;
              }
              if (msg.kind === "clientHello") {
                fail(4400, "HANDSHAKE_PROTOCOL_ERROR");
                return;
              }
              if (!limiter.allow("command:" + digest, 120)) {
                rejectLimited(c, msg.commandId);
                return;
              }
              if (requestSchema.safeParse(msg).success) {
                void service
                  .enqueue(async () => {
                    if (
                      c.closed ||
                      service.sessions.get(digest)?.lease?.id !== c.leaseId
                    )
                      return;
                    await service.publication(() => {
                      if (msg.kind === "state.request") snapshot(c);
                      else {
                        c.subscribed = msg.kind === "roomList.subscribe";
                        if (c.subscribed)
                          send(c, {
                            protocolVersion: 1,
                            kind: "roomListSnapshot",
                            rooms: service.list(),
                          });
                      }
                    });
                  })
                  .catch(() => {});
                return;
              }
              const parsed = commandSchema.safeParse(msg);
              if (!parsed.success) {
                fail(4400, "INVALID_COMMAND");
                return;
              }
              const command = parsed.data as Command;
              if (
                (command.type === "room.create" &&
                  !limiter.allow("create:" + digest, 5)) ||
                (command.type.startsWith("room.join") &&
                  !limiter.allow("join:" + digest, 10)) ||
                (command.type === "room.joinPrivate" &&
                  !limiter.allow("code:" + ip(req), 15))
              ) {
                rejectLimited(c, command.commandId);
                return;
              }
              void service
                .enqueue(async () => {
                  try {
                    const result = await service.processCommand(
                      digest,
                      c.leaseId,
                      command,
                      receivedAt,
                    );
                    await service.publication(() => {
                      send(c, result);
                      if (!result.replayed) snapshot(c);
                    });
                  } catch (e) {
                    if (e instanceof RuleError)
                      await service.publication(() =>
                        send(c, {
                          protocolVersion: 1,
                          kind: "commandResult",
                          commandId: command.commandId,
                          status: "rejected",
                          code: e.code,
                        }),
                      );
                    else throw e;
                  }
                })
                .catch(() => {});
            });
          });
        });
      })
      .catch(() => socket.destroy());
  });
  service.on("room", (roomId: string) => {
    for (const c of controllers.values())
      if (service.sessions.get(c.digest)?.binding?.roomId === roomId)
        snapshot(c);
  });
  service.on("directory", () => {
    for (const c of controllers.values())
      if (c.subscribed)
        send(c, {
          protocolVersion: 1,
          kind: "roomListSnapshot",
          rooms: service.list(),
        });
  });
  service.on(
    "membershipEnded",
    (digest: string, roomId: string, reason: string) => {
      const c = controllers.get(digest);
      if (c)
        send(c, {
          protocolVersion: 1,
          kind: "roomMembershipEnded",
          roomId,
          reason,
        });
    },
  );
  service.on("fatal", () => {
    for (const c of controllers.values())
      c.ws.close(4500, "SERVER_UNAVAILABLE");
  });
  const heartbeat = setInterval(() => {
    for (const c of controllers.values()) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, 20000).unref();
  return {
    app,
    server,
    controllers,
    async close() {
      clearInterval(heartbeat);
      for (const c of controllers.values()) c.ws.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await service.close();
    },
  };
}
