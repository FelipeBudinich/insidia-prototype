import { z } from "zod";
export const PROTOCOL_VERSION = 1;
export const SINS = [
  "ORGULLO",
  "RABIA",
  "GULA",
  "ENVIDIA",
  "AVARICIA",
  "VANIDAD",
  "LUJURIA",
  "PEREZA",
] as const;
export const CONSPIRACIES = [
  "SUPREMACIA",
  "AGONIA",
  "INDIGENCIA",
  "HEREJIA",
  "PERFIDIA",
  "APOSTASIA",
] as const;
export type Sin = (typeof SINS)[number];
export type Conspiracy = (typeof CONSPIRACIES)[number];
export const COSTS: Record<Sin, number> = {
  ORGULLO: 9,
  RABIA: 4,
  GULA: 0,
  ENVIDIA: 0,
  AVARICIA: 0,
  VANIDAD: 0,
  LUJURIA: 0,
  PEREZA: 0,
};
const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const ref = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
const name = z
  .string()
  .max(200)
  .transform((s) => s.replace(/[\p{Cc}\p{Cf}]/gu, "").trim())
  .refine((s) => [...s].length >= 1 && [...s].length <= 24);
const count = z.number().int().min(0).max(5);
const visibility = z.enum(["public", "private"]);
const object = z.strictObject;
const ordinaryAnswer = z.discriminatedUnion("kind", [
  object({ kind: z.literal("selectPlayer"), playerId: uuid }),
  object({
    kind: z.literal("selectDirection"),
    direction: z.enum(["left", "right"]),
  }),
  object({
    kind: z.literal("selectPayment"),
    choice: z.enum(["pay", "discard"]),
  }),
  object({ kind: z.literal("selectCard"), handCardRef: ref }),
  object({
    kind: z.literal("selectCards"),
    handCardRefs: z
      .array(ref)
      .length(2)
      .refine((a) => new Set(a).size === 2),
  }),
]);
const payloads = {
  "room.create": object({
    visibility,
    displayName: name,
    additionalHumanPlayers: count,
    botPlayers: count,
  }),
  "room.joinPublic": object({ displayName: name }),
  "room.joinPrivate": object({
    code: z.string().regex(/^\d{6}$/),
    displayName: name,
  }),
  "room.leave": object({}),
  "room.configure": object({
    visibility: visibility.optional(),
    additionalHumanPlayers: count.optional(),
    botPlayers: count.optional(),
  }).refine((v) => Object.keys(v).length > 0),
  "room.removePlayer": object({ targetPlayerId: uuid }),
  "room.setReady": object({ ready: z.boolean() }),
  "room.start": object({}),
  "game.takeSouls": object({ opportunityId: uuid }),
  "game.forceRandomDiscard": object({
    opportunityId: uuid,
    targetPlayerId: uuid,
  }),
  "game.conspire": object({ opportunityId: uuid }),
  "game.declareSin": object({ opportunityId: uuid, sin: z.enum(SINS) }),
  "game.passChallenge": object({ interactionId: uuid }),
  "game.challenge": object({ interactionId: uuid }),
  "game.passCounter": object({ interactionId: uuid }),
  "game.payCounter": object({ interactionId: uuid }),
};
const base = {
  protocolVersion: z.literal(1),
  kind: z.literal("command"),
  commandId: uuid,
};
const version = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const schemas = Object.entries(payloads).map(([type, payload]) =>
  object({
    ...base,
    type: z.literal(type),
    payload,
    ...(type === "room.create" || type === "room.joinPrivate"
      ? {}
      : { roomId: uuid }),
    ...(["room.create", "room.joinPublic", "room.joinPrivate"].includes(type)
      ? {}
      : { expectedStateVersion: version }),
  }),
);
export const commandSchema = z.union([
  ...schemas,
  object({
    ...base,
    type: z.literal("game.answerPrompt"),
    roomId: uuid,
    expectedStateVersion: version,
    payload: object({ promptId: uuid, answer: ordinaryAnswer }),
  }),
  object({
    ...base,
    type: z.literal("game.answerPrompt"),
    roomId: uuid,
    payload: object({
      promptId: uuid,
      answer: object({
        kind: z.literal("selectHerejiaCard"),
        handCardRef: ref,
      }),
    }),
  }),
] as unknown as [z.ZodType, ...z.ZodType[]]);
export const helloSchema = object({
  kind: z.literal("clientHello"),
  protocolVersion: z.literal(1),
  lastRoomId: uuid.optional(),
  lastSeenStateVersion: version.optional(),
});
export const requestSchema = object({
  kind: z.enum(["roomList.subscribe", "roomList.unsubscribe", "state.request"]),
  protocolVersion: z.literal(1),
});
export interface Command {
  protocolVersion: 1;
  kind: "command";
  type: string;
  commandId: string;
  roomId?: string;
  expectedStateVersion?: number;
  payload: Record<string, any>;
}
