import { commandSchema } from "../network/protocol.js";

const membershipCommands = new Set([
  "room.create", "room.joinPublic", "room.joinPrivate",
]);

// UI validation is deliberately limited to the latest viewer projection. The
// server remains authoritative, including when the deadline expires in flight.
export class Dispatcher {
  constructor(store, network) {
    this.store = store;
    this.network = network;
  }
  validate(type, payload = {}, roomId) {
    if (!this.store.connected || this.store.reconnecting)
      return "AUTH_REQUIRED";
    if (this.store.pending.size) return "COMMAND_PENDING";
    const view = this.store.view;
    if (membershipCommands.has(type)) {
      if (view) return "ALREADY_IN_ROOM";
      if (type === "room.create") {
        const total = 1 + payload.additionalHumanPlayers + payload.botPlayers;
        if (total < 3 || total > 6) return "INVALID_ROOM_CONFIG";
      }
      if (type === "room.joinPublic") {
        const room = this.store.rooms?.find((entry) => entry.roomId === roomId);
        if (room && room.occupiedHumanSeats >= room.configuredHumanSeats)
          return "ROOM_FULL";
      }
      return null;
    }
    if (!view) return "STALE_STATE";
    const legal = view.self.legalActions.find((action) => action.type === type);
    if (!legal) return "ACTION_NOT_ALLOWED";
    for (const key of ["opportunityId", "interactionId", "promptId"])
      if (legal[key] !== undefined && legal[key] !== payload[key])
        return "STALE_STATE";
    if (type.startsWith("game.")) {
      const deadline = type === "game.answerPrompt"
        ? view.self.prompt?.deadline
        : payload.interactionId
          ? view.public.interaction?.deadline
          : view.public.turn?.deadline;
      // Equality belongs to timeout. Waiting for authority is safer than an
      // enabled button on an expired, disconnected, or malformed projection.
      if (!deadline || !Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= this.store.now())
        return "DECISION_EXPIRED";
    }
    if (type === "game.declareSin" && !legal.allowedSins?.includes(payload.sin))
      return "ACTION_NOT_ALLOWED";
    if (type === "game.forceRandomDiscard" &&
      !legal.eligiblePlayerIds?.includes(payload.targetPlayerId))
      return "INVALID_TARGET";
    if (type === "room.removePlayer" &&
      !legal.eligiblePlayerIds?.includes(payload.targetPlayerId))
      return "INVALID_TARGET";
    if (type === "room.configure") {
      if (legal.configurableFields && Object.keys(payload).some(
        (key) => !legal.configurableFields.includes(key),
      )) return "ACTION_NOT_ALLOWED";
      const config = view.public.room.config;
      const total = 1 + (payload.additionalHumanPlayers ?? config.additionalHumanPlayers) +
        (payload.botPlayers ?? config.botPlayers);
      if (total < 3 || total > 6) return "INVALID_ROOM_CONFIG";
    }
    if (type === "game.answerPrompt") {
      const prompt = view.self.prompt, answer = payload.answer;
      if (!prompt || prompt.promptId !== payload.promptId ||
          prompt.kind !== answer?.kind || prompt.submitted)
        return "STALE_STATE";
      switch (prompt.kind) {
        case "selectPlayer":
          if (!prompt.eligiblePlayerIds.includes(answer.playerId)) return "INVALID_TARGET";
          break;
        case "selectDirection":
          if (!prompt.options.includes(answer.direction)) return "ACTION_NOT_ALLOWED";
          break;
        case "selectPayment":
          if (!prompt.options.includes(answer.choice)) return "ACTION_NOT_ALLOWED";
          break;
        case "selectCard":
        case "selectHerejiaCard":
          if (!prompt.eligibleHandCardRefs.includes(answer.handCardRef)) return "CARD_NOT_OWNED";
          break;
        case "selectCards": {
          const refs = answer.handCardRefs;
          if (!Array.isArray(refs) || refs.length !== prompt.count ||
              new Set(refs).size !== refs.length ||
              refs.some((ref) => !prompt.eligibleHandCardRefs.includes(ref)))
            return "CARD_NOT_OWNED";
          break;
        }
        default: return "ACTION_NOT_ALLOWED";
      }
    }
    return null;
  }
  reject(type, origin, code) {
    if (code === "COMMAND_PENDING") return false;
    this.store.error = code;
    this.store.commandFeedback = { type, origin, status: "rejected", code };
    this.store.version++;
    return false;
  }
  send(type, payload = {}, roomId, origin = type) {
    const rejection = this.validate(type, payload, roomId);
    if (rejection) return this.reject(type, origin, rejection);
    const view = this.store.view;
    const command = {
      protocolVersion: 1,
      kind: "command",
      type,
      commandId: crypto.randomUUID(),
      payload,
    };
    if (type === "room.joinPublic") command.roomId = roomId;
    else if (!membershipCommands.has(type)) {
      command.roomId = view.roomId;
      if (payload.answer?.kind !== "selectHerejiaCard")
        command.expectedStateVersion = view.stateVersion;
    }
    const parsed = commandSchema.safeParse(command);
    if (!parsed.success)
      return this.reject(type, origin, type.startsWith("room.")
        ? "INVALID_ROOM_CONFIG" : "ACTION_NOT_ALLOWED");
    if (!this.network.send(parsed.data))
      return this.reject(type, origin, "AUTH_REQUIRED");
    this.store.error = null;
    this.store.pending.set(command.commandId, {
      command: parsed.data,
      origin,
      sentAt: Date.now(),
    });
    this.store.commandFeedback = {
      type, origin, commandId: command.commandId, status: "pending",
    };
    this.store.version++;
    return true;
  }
  retry() {
    for (const pending of this.store.pending.values())
      if (Date.now() - pending.sentAt > 5000 && this.store.connected &&
          !this.store.reconnecting) {
        // A retry resends the original receipt identity and payload, including
        // when current legality/deadlines changed while its result was lost.
        this.network.send(pending.command);
        pending.sentAt = Date.now();
      }
  }
}
