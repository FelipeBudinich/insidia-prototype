export class ClientStore {
  constructor() {
    this.view = null;
    this.rooms = [];
    this.connected = false;
    this.epoch = null;
    this.revision = 0n;
    this.serverOffset = 0;
    this.pending = new Map();
    this.error = null;
    this.version = 0;
  }
  apply(message) {
    if (message.serverTime)
      this.serverOffset = Date.parse(message.serverTime) - Date.now();
    if (message.kind === "sessionReady") {
      this.connected = true;
      this.epoch = message.projectionEpoch;
      this.revision = 0n;
      if (!message.resumableRoomId) this.view = null;
      this.version++;
    }
    if (message.kind === "stateSnapshot") {
      if (message.projectionEpoch !== this.epoch) return;
      const revision = BigInt(message.projectionRevision);
      if (revision <= this.revision) return;
      if (
        this.view?.roomId === message.roomId &&
        message.stateVersion < this.view.stateVersion
      )
        return;
      this.revision = revision;
      this.view = message;
      this.version++;
    }
    if (message.kind === "roomListSnapshot") {
      this.rooms = message.rooms;
      this.version++;
    }
    if (message.kind === "roomMembershipEnded") {
      this.view = null;
      this.version++;
    }
    if (message.kind === "commandResult") {
      this.pending.delete(message.commandId);
      if (message.status === "rejected") this.error = message.code;
      this.version++;
    }
  }
  clearConnection() {
    this.connected = false;
    this.view = null;
    this.version++;
  }
  now() {
    return Date.now() + this.serverOffset;
  }
}
