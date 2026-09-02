import {
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  randomInt,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { instant, type Environment } from "../domain/model.js";
export function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
      .join(",") +
    "}"
  );
}
export const hash = (v: unknown) =>
  "sha256:" + createHash("sha256").update(canonical(v)).digest("hex");
export interface Ciphertext {
  version: 1;
  nonce: string;
  ciphertext: string;
  tag: string;
}
export class Security {
  private keys: Record<string, Buffer> = {};
  constructor(secret: Buffer) {
    if (secret.length !== 32)
      throw new Error("APP_SECRET must contain 32 bytes");
    for (const purpose of [
      "aead",
      "session",
      "command",
      "code",
      "hand",
      "public",
    ])
      this.keys[purpose] = Buffer.from(
        hkdfSync("sha256", secret, "insidia2-v1", purpose, 32),
      );
  }
  fingerprint() {
    return Object.fromEntries(
      Object.entries(this.keys).map(([k, v]) => [
        k,
        createHash("sha256").update(v).digest("hex"),
      ]),
    );
  }
  hmac(purpose: string, v: unknown) {
    return createHmac("sha256", this.keys[purpose])
      .update(canonical(v))
      .digest("base64url");
  }
  newCredential() {
    return "gsc1." + randomBytes(32).toString("base64url");
  }
  credentialDigest(raw: string) {
    if (!/^gsc1\.[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(raw)) return null;
    return "g1." + this.hmac("session", raw);
  }
  encrypt(value: unknown, aad: string): Ciphertext {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.keys.aead, nonce);
    cipher.setAAD(Buffer.from(aad));
    const encrypted = Buffer.concat([
      cipher.update(canonical(value), "utf8"),
      cipher.final(),
    ]);
    return {
      version: 1,
      nonce: nonce.toString("base64url"),
      ciphertext: encrypted.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
    };
  }
  decrypt(blob: Ciphertext, aad: string): any {
    if (blob.version !== 1) throw new Error("Unsupported encryption format");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.keys.aead,
      Buffer.from(blob.nonce, "base64url"),
    );
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(blob.tag, "base64url"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(blob.ciphertext, "base64url")),
        decipher.final(),
      ]).toString(),
    );
  }
  environment(now: () => string = () => instant(Date.now())): Environment {
    return {
      now,
      id: randomUUID,
      integer: randomInt,
      hash,
      handRef: (r, s, c) =>
        this.hmac("hand", [
          r.roomId,
          r.game!.gameId,
          s.playerId,
          c.id,
          c.epoch,
        ]),
      publicRef: (r, c) =>
        this.hmac("public", [r.roomId, r.game!.gameId, c.id, c.epoch]),
    };
  }
}
