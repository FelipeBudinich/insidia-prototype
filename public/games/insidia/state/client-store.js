import { PresentationDirector } from "../presentation/presentation-director.js";
import { ServerClock, monotonicNow } from "../presentation/motion-tokens.js";
import { publicOnlyProjection } from "./presented-state.js";

export class ClientStore {
  constructor(options = {}) {
    this.view = null;
    this.rooms = [];
    this.connected = false;
    this.epoch = null;
    this.revision = 0n;
    this.serverOffset = 0;
    this.pending = new Map();
    this.error = null;
    this.version = 0;
    this.reconnecting = false;
    this.commandFeedback = null;
    this.clock = new ServerClock(options.now ?? monotonicNow, options.wallNow ?? Date.now);
    this.presentation = new PresentationDirector(options);
  }
  apply(message) {
    if (message.kind === "sessionReady") {
      if (typeof message.projectionEpoch !== "string" || !message.projectionEpoch) return false;
      if (this.connected && this.epoch === message.projectionEpoch) return false;
      const changedEpoch = this.epoch !== message.projectionEpoch;
      this.connected = true;
      this.reconnecting = !!message.resumableRoomId;
      this.epoch = message.projectionEpoch;
      this.revision = 0n;
      if (changedEpoch) this.presentation.disconnect();
      if (!message.resumableRoomId || (this.view && this.view.roomId !== message.resumableRoomId)) {
        this.view = null;
        this.pending.clear();
        this.commandFeedback = null;
        this.presentation.reset();
      } else this.view = publicOnlyProjection(this.view);
      this.sampleClock(message);
      this.version++;
      return true;
    }
    if (message.kind === "stateSnapshot") {
      if (message.projectionEpoch !== this.epoch || !this.connected) return false;
      if (typeof message.projectionRevision !== "string" || !/^\d+$/.test(message.projectionRevision) ||
        !Number.isSafeInteger(message.stateVersion) || message.stateVersion < 0 ||
        typeof message.roomId !== "string" || !message.public?.room || !message.self) return false;
      const revision = BigInt(message.projectionRevision);
      if (revision <= this.revision) return false;
      if (
        this.view?.roomId === message.roomId &&
        message.stateVersion < this.view.stateVersion
      )
        return false;
      const previous = this.view;
      if (previous && previous.roomId !== message.roomId) {
        this.pending.clear();
        this.commandFeedback = null;
      }
      this.revision = revision;
      const abandoned = message.public.result?.endReason === "abandoned";
      this.view = abandoned ? {
        ...publicOnlyProjection(message),
        self: { ...publicOnlyProjection(message).self,
          legalActions: message.self.legalActions.filter((action) => action.type === "room.leave") },
      } : message;
      if (message.public.room.status === "faulted") {
        this.pending.clear();
        this.commandFeedback = null;
      }
      this.reconnecting = false;
      this.sampleClock(message);
      // This call runs before the next network message is drained, including
      // equal-stateVersion private acknowledgments with a newer revision.
      this.presentation.ingest(this.view, previous);
      this.version++;
      return true;
    }
    if (message.kind === "roomListSnapshot") {
      if (!Array.isArray(message.rooms)) return false;
      this.rooms = message.rooms;
      this.version++;
      return true;
    }
    if (message.kind === "roomMembershipEnded") {
      if (message.roomId && this.view && message.roomId !== this.view.roomId) return false;
      this.view = null;
      this.pending.clear();
      this.commandFeedback = null;
      this.presentation.reset();
      this.reconnecting = false;
      this.version++;
      return true;
    }
    if (message.kind === "commandResult") {
      const pending = this.pending.get(message.commandId);
      if (pending) {
        this.commandFeedback = {
          origin: pending.origin ?? this.commandFeedback?.origin,
          type: pending.command.type,
          status: message.status,
          code: message.code,
          commandId: message.commandId,
        };
        this.sampleClock(message);
      }
      this.pending.delete(message.commandId);
      if (message.status === "rejected") this.error = message.code;
      this.version++;
      return true;
    }
    return false;
  }
  clearConnection({ superseded = false } = {}) {
    this.connected = false;
    this.reconnecting = !superseded && !!this.view;
    this.view = superseded ? null : publicOnlyProjection(this.view);
    if (superseded) {
      this.pending.clear();
      this.commandFeedback = null;
    }
    this.presentation.disconnect({ superseded });
    this.version++;
  }
  sampleClock(message) {
    if (message.serverTime && this.clock.sample(message.serverTime))
      this.serverOffset = Date.parse(message.serverTime) - this.clock.wallNow();
  }
  now() {
    return this.clock.now();
  }
}
