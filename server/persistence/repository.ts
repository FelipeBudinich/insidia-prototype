import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Security, hash, canonical } from "../security/crypto.js";
import type { Room, Session, Sealed } from "../domain/model.js";
export interface Write {
  family: "room" | "session" | "sealed" | "incident";
  id: string;
  value: any;
  version: number;
  event?: { type: string; commandId?: string; effectiveAt: string };
  previous?: any;
}
export interface Receipt {
  principal: string;
  commandId: string;
  digest: string;
  status: "pending" | "final";
  value: any;
  ingress?: string;
}
export interface Repository {
  epoch: string;
  initialize(): Promise<void>;
  load(family: string): Promise<any[]>;
  commit(writes: Write[], receipt?: Receipt): Promise<void>;
  receipt(principal: string, id: string): Promise<Receipt | undefined>;
  pending(): Promise<Receipt[]>;
  close(): Promise<void>;
  recovered?(): Promise<void>;
  onFatal?: () => void;
}
export function pgOptions(url: string) {
  const parsed = new URL(url);
  if (parsed.port === "6543")
    throw new Error(
      "Use Supabase session pooler port 5432, not transaction mode",
    );
  return {
    connectionString: url,
    ssl:
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
        ? false
        : {
            rejectUnauthorized: true,
            ca: readFileSync("server/security/certs/supabase-ca.crt", "utf8"),
          },
    max: 3,
    connectionTimeoutMillis: 15000,
    application_name: "insidia2",
  };
}
export class PostgresRepository implements Repository {
  epoch = randomUUID();
  fence = "0";
  pool: pg.Pool;
  owner?: pg.PoolClient;
  onFatal?: () => void;
  constructor(
    url: string,
    private security: Security,
  ) {
    this.pool = new pg.Pool(pgOptions(url));
    this.pool.on("error", () => this.onFatal?.());
  }
  async initialize() {
    const c = await this.pool.connect();
    this.owner = c;
    try {
      const schema = await c.query(
        "SELECT version FROM insidia2.schema_version WHERE id=1",
      );
      if (schema.rows[0]?.version !== 1)
        throw new Error("Database migration required");
      const lock = await c.query(
        "SELECT pg_try_advisory_lock(1229865801,1145655553) AS acquired",
      );
      if (!lock.rows[0].acquired)
        throw new Error("Another game server owns this database");
      c.on("error", () => this.onFatal?.());
      await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const keys = await c.query(
        "SELECT fingerprints FROM insidia2.keys WHERE id=1",
      );
      if (
        keys.rows.length &&
        canonical(keys.rows[0].fingerprints) !==
          canonical(this.security.fingerprint())
      )
        throw new Error("Persistence key mismatch");
      if (!keys.rows.length)
        await c.query("INSERT INTO insidia2.keys VALUES(1,$1)", [
          this.security.fingerprint(),
        ]);
      const old = await c.query(
        "SELECT fence FROM insidia2.owner WHERE id=1 FOR UPDATE",
      );
      this.fence = String(BigInt(old.rows[0]?.fence ?? "0") + 1n);
      await c.query(
        "INSERT INTO insidia2.epochs VALUES($1,$2,clock_timestamp(),NULL)",
        [this.epoch, this.fence],
      );
      await c.query(
        "INSERT INTO insidia2.owner VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET epoch=$1,fence=$2",
        [this.epoch, this.fence],
      );
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    }
  }
  async guard(c: pg.PoolClient) {
    const r = await c.query(
      "SELECT epoch,fence FROM insidia2.owner WHERE id=1 FOR SHARE",
    );
    if (r.rows[0]?.epoch !== this.epoch || r.rows[0]?.fence !== this.fence)
      throw new Error("Server fence lost");
  }
  async encrypted(c: pg.PoolClient, value: any, owner: string) {
    const blob = this.security.encrypt(value, owner);
    await c.query("INSERT INTO insidia2.nonces VALUES($1,$2)", [
      blob.nonce,
      owner,
    ]);
    return blob;
  }
  async load(family: string) {
    const c = await this.pool.connect();
    try {
      const result = await c.query(
        "SELECT * FROM insidia2.records WHERE family=$1 ORDER BY id",
        [family],
      );
      const values = [];
      for (const row of result.rows) {
        const owner = "record:" + row.write_id;
        const nonce = await c.query(
          "SELECT owner FROM insidia2.nonces WHERE nonce=$1",
          [row.body.nonce],
        );
        if (nonce.rows[0]?.owner !== owner)
          throw new Error("Invalid nonce owner");
        const value = this.security.decrypt(row.body, owner);
        if (
          (family === "session" &&
            (value.digest !== row.id || value.generation !== Number(row.version))) ||
          (family === "room" && value.roomId !== row.id) ||
          (family === "sealed" &&
            `${value.roomId}:${value.promptId}:${value.playerId}` !== row.id)
        ) throw new Error("Encrypted record identity mismatch");
        if (family === "room") {
          const e = await c.query(
            "SELECT * FROM insidia2.events WHERE room_id=$1 ORDER BY state_version",
            [row.id],
          );
          let previous = "genesis", sequence = 0;
          for (const event of e.rows) {
            const reservation = await c.query(
              "SELECT owner FROM insidia2.nonces WHERE nonce=$1",
              [event.body.nonce],
            );
            if (reservation.rows[0]?.owner !== "event:" + event.event_id)
              throw new Error("Event nonce reservation mismatch");
            const eventValue = this.security.decrypt(
              event.body,
              "event:" + event.event_id,
            );
            if (
              event.previous_hash !== previous ||
              eventValue.after.roomId !== row.id ||
              Number(event.state_version) !== ++sequence ||
              hash(eventValue.after) !== event.state_hash ||
              eventValue.after.stateVersion !== Number(event.state_version)
            )
              throw new Error("Event chain invalid");
            previous = event.state_hash;
          }
          if (
            previous !== hash(value) ||
            Number(row.version) !== value.stateVersion
          )
            throw new Error("Snapshot/event mismatch");
        }
        values.push(value);
      }
      return values;
    } finally {
      c.release();
    }
  }
  async commit(writes: Write[], receipt?: Receipt) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      await this.guard(c);
      for (const w of writes
        .filter((w) => w.family === "session")
        .sort((a, b) => a.id.localeCompare(b.id)))
        await c.query(
          "SELECT id FROM insidia2.records WHERE family='session' AND id=$1 FOR UPDATE",
          [w.id],
        );
      for (const w of writes) {
        if (w.value === null) {
          await c.query(
            "DELETE FROM insidia2.records WHERE family=$1 AND id=$2",
            [w.family, w.id],
          );
          continue;
        }
        const writeId = randomUUID(),
          body = await this.encrypted(c, w.value, "record:" + writeId);
        if (w.family === "room") {
          const last = await c.query(
            "SELECT version FROM insidia2.records WHERE family=$1 AND id=$2 FOR UPDATE",
            [w.family, w.id],
          );
          if (Number(last.rows[0]?.version ?? 0) !== w.version - 1)
            throw new Error("Room CAS failed");
          const eventId = randomUUID(),
            previousHash = w.previous ? hash(w.previous) : "genesis",
            stateHash = hash(w.value);
          const event = await this.encrypted(
            c,
            { schemaVersion: 1, ...w.event, after: w.value },
            "event:" + eventId,
          );
          await c.query(
            "INSERT INTO insidia2.events VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
            [
              w.id,
              w.version,
              eventId,
              this.epoch,
              this.fence,
              previousHash,
              stateHash,
              event,
            ],
          );
          await c.query("DELETE FROM insidia2.codes WHERE room_id=$1", [w.id]);
          if (w.value.privateCode)
            await c.query("INSERT INTO insidia2.codes VALUES($1,$2,$3)", [
              this.security.hmac("code", w.value.privateCode),
              w.id,
              w.value.privateCodeGeneration,
            ]);
        }
        await c.query(
          "INSERT INTO insidia2.records VALUES($1,$2,$3,$4,$5) ON CONFLICT(family,id) DO UPDATE SET version=$3,write_id=$4,body=$5",
          [w.family, w.id, w.version, writeId, body],
        );
        if (w.family === "session") {
          const s = w.value as Session;
          const current = await c.query(
            "SELECT generation FROM insidia2.bindings WHERE session_digest=$1 AND released_at IS NULL FOR UPDATE",
            [s.digest],
          );
          if (
            current.rows.length &&
            (!s.binding || current.rows[0].generation !== s.binding.generation)
          )
            await c.query(
              "UPDATE insidia2.bindings SET released_at=clock_timestamp() WHERE session_digest=$1 AND released_at IS NULL",
              [s.digest],
            );
          if (
            s.binding &&
            (!current.rows.length ||
              current.rows[0].generation !== s.binding.generation)
          )
            await c.query(
              "INSERT INTO insidia2.bindings VALUES($1,$2,$3,$4,clock_timestamp(),NULL)",
              [
                s.digest,
                s.binding.generation,
                s.binding.roomId,
                s.binding.playerId,
              ],
            );
        }
      }
      if (receipt) {
        const owner =
            "receipt:" +
            receipt.principal +
            ":" +
            receipt.commandId +
            ":" +
            receipt.status,
          body = await this.encrypted(c, receipt.value, owner);
        await c.query(
          "INSERT INTO insidia2.receipts(principal,command_id,digest,status,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(principal,command_id) DO UPDATE SET status=$4,body=$5 WHERE insidia2.receipts.status='pending' AND insidia2.receipts.digest=$3",
          [
            receipt.principal,
            receipt.commandId,
            receipt.digest,
            receipt.status,
            body,
          ],
        );
      }
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  async receipt(principal: string, id: string) {
    const r = await this.pool.query(
      "SELECT * FROM insidia2.receipts WHERE principal=$1 AND command_id=$2",
      [principal, id],
    );
    return r.rows.length ? this.decodeReceipt(r.rows[0]) : undefined;
  }
  decodeReceipt(r: any): Receipt {
    return {
      principal: r.principal,
      commandId: r.command_id,
      digest: r.digest,
      status: r.status,
      ingress: r.ingress,
      value: this.security.decrypt(
        r.body,
        "receipt:" + r.principal + ":" + r.command_id + ":" + r.status,
      ),
    };
  }
  async pending() {
    const r = await this.pool.query(
      "SELECT * FROM insidia2.receipts WHERE status='pending' ORDER BY ingress",
    );
    return r.rows.map((r) => this.decodeReceipt(r));
  }
  async databaseTime() {
    const r = await this.pool.query(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS now`,
    );
    return r.rows[0].now as string;
  }
  async recovered() {
    await this.pool.query(
      "UPDATE insidia2.epochs SET recovered_at=clock_timestamp() WHERE epoch=$1 AND recovered_at IS NULL",
      [this.epoch],
    );
  }
  async close() {
    if (this.owner) {
      await this.owner
        .query("SELECT pg_advisory_unlock(1229865801,1145655553)")
        .catch(() => {});
      this.owner.release();
      this.owner = undefined;
    }
    await this.pool.end();
  }
}
export class MemoryRepository implements Repository {
  epoch = randomUUID();
  records = new Map<string, any>();
  receipts = new Map<string, Receipt>();
  history: Write[] = [];
  async initialize() {}
  async load(family: string) {
    return [...this.records.entries()]
      .filter(([k]) => k.startsWith(family + ":"))
      .map(([, v]) => structuredClone(v));
  }
  async commit(writes: Write[], receipt?: Receipt) {
    for (const w of writes) {
      if (w.value === null) this.records.delete(w.family + ":" + w.id);
      else this.records.set(w.family + ":" + w.id, structuredClone(w.value));
      this.history.push(structuredClone(w));
    }
    if (receipt)
      this.receipts.set(
        receipt.principal + receipt.commandId,
        structuredClone(receipt),
      );
  }
  async receipt(p: string, id: string) {
    return structuredClone(this.receipts.get(p + id));
  }
  async pending() {
    return [...this.receipts.values()].filter((r) => r.status === "pending");
  }
  async close() {}
}
