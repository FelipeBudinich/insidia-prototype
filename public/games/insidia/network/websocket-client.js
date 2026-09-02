export class Network {
  constructor() {
    this.queue = [];
    this.socket = null;
    this.retry = 0;
    this.stopped = false;
    this.generation = 0;
  }
  async connect() {
    const generation = ++this.generation;
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error("connection");
      if (generation !== this.generation) return;
      const socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
      );
      this.socket = socket;
      socket.onmessage = (event) => {
        if (this.socket !== socket) return;
        const message = JSON.parse(event.data);
        if (message.kind === "serverHello")
          socket.send(
            JSON.stringify({ protocolVersion: 1, kind: "clientHello" }),
          );
        else {
          this.queue.push(message);
          if (message.kind === "sessionReady") {
            this.retry = 0;
            socket.send(
              JSON.stringify({
                protocolVersion: 1,
                kind: "roomList.subscribe",
              }),
            );
          }
        }
      };
      socket.onclose = (event) => {
        if (this.socket !== socket) return;
        this.queue.push({
          kind: "disconnected",
          superseded: event.code === 4409,
        });
        if (event.code === 4409) {
          this.stopped = true;
          return;
        }
        this.reconnect();
      };
      socket.onerror = () => {};
    } catch {
      this.queue.push({ kind: "disconnected" });
      this.reconnect();
    }
  }
  reconnect() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => this.connect(),
      Math.min(10000, 750 * 2 ** this.retry++),
    );
  }
  send(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }
  drain() {
    return this.queue.splice(0);
  }
}
