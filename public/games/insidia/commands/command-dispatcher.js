import { commandSchema } from "../network/protocol.js";
export class Dispatcher {
  constructor(store, network) {
    this.store = store;
    this.network = network;
  }
  send(type, payload = {}, roomId, origin = type) {
    if (!this.store.connected || this.store.pending.size) return false;
    const view = this.store.view;
    const command = {
      protocolVersion: 1,
      kind: "command",
      type,
      commandId: crypto.randomUUID(),
      payload,
    };
    if (type === "room.joinPublic" || (type === "room.joinPrivate" && roomId)) command.roomId = roomId;
    else if (!["room.create", "room.joinPrivate"].includes(type)) {
      if (!view) return false;
      command.roomId = view.roomId;
      if (payload.answer?.kind !== "selectHerejiaCard")
        command.expectedStateVersion = view.stateVersion;
    }
    const parsed = commandSchema.safeParse(command);
    if (!parsed.success) {
      this.store.error = "INVALID_ROOM_CONFIG";
      if (type.startsWith("room."))
        this.store.commandFeedback = { type, origin, status: "rejected", code: "INVALID_ROOM_CONFIG" };
      this.store.version++;
      return false;
    }
    if (this.network.send(parsed.data)) {
      this.store.pending.set(command.commandId, {
        command: parsed.data,
        sentAt: Date.now(),
        ...(type.startsWith("room.") ? { origin } : {}),
      });
      if (type.startsWith("room."))
        this.store.commandFeedback = { type, origin, commandId: command.commandId, status: "pending" };
      this.store.version++;
      return true;
    }
    return false;
  }
  retry() {
    for (const pending of this.store.pending.values())
      if (Date.now() - pending.sentAt > 5000 && this.store.connected) {
        this.network.send(pending.command);
        pending.sentAt = Date.now();
      }
  }
}
