import ig from "../../../lib/impact/impact.js";
import { ClientStore } from "../state/client-store.js";
import { Network } from "../network/websocket-client.js";
import { Dispatcher } from "../commands/command-dispatcher.js";
import { HomeScene, escape } from "../scenes/home-scene.js";
import { LobbyScene } from "../scenes/lobby-scene.js";
import { BoardRenderer } from "../ui/board-renderer.js";
import { errors } from "../ui/strings.js";
import {
  fitCanvasToViewport,
  RENDER_SCALE,
  toDesignPoint,
} from "../resolution.js";
export const InsidiaGame = ig.Game.extend({
  init() {
    this.store = new ClientStore();
    this.network = new Network();
    this.dispatch = new Dispatcher(this.store, this.network);
    this.home = new HomeScene(this.store, this.dispatch);
    this.lobby = new LobbyScene(this.store, this.dispatch, this.home);
    this.board = new BoardRenderer(this.store, this.dispatch, this.home);
    this.lastVersion = -1;
    this.superseded = false;
    ig.input.bind("MousePrimary", "click");
    this.resize = () => {
      const layout = fitCanvasToViewport(innerWidth, innerHeight),
        stage = document.getElementById("stage"),
        canvas = document.getElementById("canvas");
      stage.style.width = canvas.style.width = layout.width + "px";
      stage.style.height = canvas.style.height = layout.height + "px";
      stage.style.left = layout.left + "px";
      stage.style.top = layout.top + "px";
    };
    window.addEventListener("resize", this.resize);
    this.resize();
    this.network.connect();
    this.renderShell();
  },
  update() {
    this.parent();
    for (const message of this.network.drain()) {
      if (message.kind === "disconnected") {
        this.store.clearConnection();
        this.superseded = !!message.superseded;
      } else this.store.apply(message);
    }
    if (this.store.error) {
      this.toast(
        errors[this.store.error] ??
          "No se pudo completar la acción. Inténtalo de nuevo.",
      );
      if (this.store.error === "ALREADY_IN_ROOM")
        this.network.send({ protocolVersion: 1, kind: "state.request" });
      this.store.error = null;
    }
    if (this.lastVersion !== this.store.version) {
      this.renderShell();
      this.lastVersion = this.store.version;
    }
    this.board.update(
      toDesignPoint(ig.input.mouse),
      ig.input.pressed("click"),
    );
    this.dispatch.retry();
  },
  renderShell() {
    const state = this.store.view?.public.room.status;
    document.body.classList.toggle(
      "match",
      state === "active" || state === "finished",
    );
    const connected = document.getElementById("connection");
    connected.className = this.store.connected ? "" : "visible";
    connected.textContent = this.superseded
      ? "Esta sesión está abierta en otra pestaña. Recarga para volver aquí."
      : "Conectando con la mesa…";
    if (!this.store.connected || !this.store.view) this.home.render();
    else if (state === "lobby") this.lobby.render();
    else if (state === "faulted") {
      document.getElementById("shell").innerHTML =
        this.home.header() +
        `<div class="panel" style="max-width:650px;margin:100px auto"><div class="eyebrow">Partida no disponible</div><h2 style="margin-top:20px">La mesa se ha cerrado.</h2><p>No se puede continuar esta partida. Puedes volver al inicio y crear otra.</p><p>Referencia: ${escape(this.store.view.public.integrityFault.reference)}</p><button id="fault-leave" class="primary">Volver al inicio</button></div>`;
      document.getElementById("fault-leave").onclick = () =>
        this.dispatch.send("room.leave");
      this.home.bindCommon(document.getElementById("shell"));
    }
  },
  draw() {
    this.parent();
    if (this.store.connected && this.store.view) {
      const context = ig.system.context;
      context.save();
      context.scale(RENDER_SCALE, RENDER_SCALE);
      try {
        this.board.draw(context);
      } finally {
        context.restore();
      }
    }
  },
  toast(text) {
    const el = document.getElementById("toast");
    el.textContent = text;
    el.className = "visible";
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => (el.className = ""), 4500);
  },
});
