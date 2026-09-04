import ig from "../../../lib/impact/impact.js";
import { ClientStore } from "../state/client-store.js";
import { Network } from "../network/websocket-client.js";
import { Dispatcher } from "../commands/command-dispatcher.js";
import { HomeScene, escape } from "../scenes/home-scene.js";
import { LobbyScene } from "../scenes/lobby-scene.js";
import { BoardRenderer } from "../ui/board-renderer.js";
import { errors } from "../ui/strings.js";
import {
  viewportResolution,
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
    this.lastFrameAt = null;
    this.frameSubmissionAt = null;
    this.inputFeedbackAt = null;
    this.superseded = false;
    ig.input.bind("MousePrimary", "click");
    this.resize = () => {
      const layout = viewportResolution(innerWidth, innerHeight, devicePixelRatio),
        stage = document.getElementById("stage"),
        canvas = document.getElementById("canvas");
      this.viewport = layout;
      ig.system.resize(layout.backingWidth, layout.backingHeight, 1);
      stage.style.width = canvas.style.width = layout.width + "px";
      stage.style.height = canvas.style.height = layout.height + "px";
      stage.style.left = layout.left + "px";
      stage.style.top = layout.top + "px";
      this.board.resize?.(layout.width, layout.height);
      this.store.presentation.finishCosmetics();
    };
    window.addEventListener("resize", this.resize);
    this.visibilityChanged = () => {
      this.store.presentation.setHidden(document.hidden);
      this.lastFrameAt = null;
      this.inputFeedbackAt = null;
      if (!document.hidden && this.store.connected)
        this.network.send({ protocolVersion: 1, kind: "state.request" });
    };
    document.addEventListener("visibilitychange", this.visibilityChanged);
    this.captureFeedback = (event) => {
      if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
      if (document.hidden || !event.target.closest?.("#premium-ui [data-control-id]")) return;
      this.inputFeedbackAt ??= performance.now();
    };
    document.addEventListener("pointerdown", this.captureFeedback, true);
    document.addEventListener("keydown", this.captureFeedback, true);
    this.store.presentation.setHidden(document.hidden);
    this.resize();
    this.network.connect();
    this.renderShell();
  },
  update() {
    const frameAt = performance.now();
    this.frameSubmissionAt = frameAt;
    if (!document.hidden && this.store.view?.public.board) {
      if (this.lastFrameAt !== null)
        this.store.presentation.recordMetric("frameIntervalMs", frameAt - this.lastFrameAt);
      this.lastFrameAt = frameAt;
    } else this.lastFrameAt = null;
    this.parent();
    for (const message of this.network.drain()) {
      if (message.kind === "disconnected") {
        this.store.clearConnection({ superseded: !!message.superseded });
        this.superseded = !!message.superseded;
      } else {
        this.store.apply(message);
        if (message.kind === "sessionReady") this.superseded = false;
      }
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
    this.store.presentation.update();
    this.home.syncRules?.();
    this.board.update(
      toDesignPoint(ig.input.mouse, this.viewport.renderScale),
      ig.input.pressed("click"),
    );
    this.store.presentation.markDecisionReady();
    this.dispatch.retry();
  },
  renderShell() {
    const state = this.store.view?.public.room.status;
    document.body.classList.toggle(
      "landing",
      !this.store.view && this.home.screen === "home",
    );
    document.body.classList.toggle(
      "match",
      state === "active" || state === "finished",
    );
    const connected = document.getElementById("connection");
    connected.className = this.store.connected && !this.store.reconnecting ? "" : "visible";
    connected.textContent = this.superseded
      ? "Esta sesión está abierta en otra pestaña. Recarga para volver aquí."
      : this.store.view ? "Reconectando con la mesa…" : "Conectando con la mesa…";
    if (!this.store.view) this.home.render();
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
    if (this.store.view) {
      const context = ig.system.context;
      context.save();
      context.scale(this.viewport.renderScale, this.viewport.renderScale);
      try {
        this.board.draw(context);
        this.store.presentation.markRevealsReady();
      } finally {
        context.restore();
      }
    }
    if (!document.hidden && this.store.view?.public.board) {
      const finishedAt = performance.now();
      if (this.frameSubmissionAt !== null)
        this.store.presentation.recordMetric("frameSubmissionMs", finishedAt - this.frameSubmissionAt);
      if (this.inputFeedbackAt !== null) {
        this.store.presentation.recordMetric("inputToFeedbackMs", finishedAt - this.inputFeedbackAt);
        this.inputFeedbackAt = null;
      }
    }
  },
  destroy() {
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    document.removeEventListener("pointerdown", this.captureFeedback, true);
    document.removeEventListener("keydown", this.captureFeedback, true);
    clearTimeout(this.toastTimeout);
    this.board.destroy?.();
    this.store.presentation.destroy();
    this.network.stopped = true;
    this.network.generation++;
    clearTimeout(this.network.timer);
    const socket = this.network.socket;
    this.network.socket = null;
    socket?.close();
  },
  toast(text) {
    const el = document.getElementById("toast");
    el.textContent = text;
    el.className = "visible";
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => (el.className = ""), 4500);
  },
});
