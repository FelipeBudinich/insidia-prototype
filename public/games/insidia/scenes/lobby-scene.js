import { escape, patchShell, commandMessage } from "./home-scene.js";
export class LobbyScene {
  constructor(store, dispatch, home) {
    this.store = store;
    this.dispatch = dispatch;
    this.home = home;
    this.configDraft = null;
    this.dirtyFields = new Set();
  }
  render() {
    const v = this.store.view,
      r = v.public.room,
      players = v.public.players,
      me = players.find((p) => p.playerId === v.self.playerId),
      host = v.public.lifecycle.hostPlayerId,
      can = (type) => v.self.legalActions.some((a) => a.type === type),
      disabled = this.home.disabled(),
      shell = document.getElementById("shell");
    if (this.draftRoom !== v.roomId) {
      this.draftRoom = v.roomId;
      this.dirtyFields.clear();
      this.configDraft = null;
    }
    const authoritativeConfig = {
      visibility: r.visibility,
      additionalHumanPlayers: r.config.additionalHumanPlayers,
      botPlayers: r.config.botPlayers,
    };
    this.configDraft ??= { ...authoritativeConfig };
    for (const [field, value] of Object.entries(authoritativeConfig)) {
      if (this.configDraft[field] === value) this.dirtyFields.delete(field);
      if (!this.dirtyFields.has(field)) this.configDraft[field] = value;
    }
    const draft = this.configDraft;
    patchShell(shell,
      this.home.header() +
      `<section><div class="lobby-heading"><div><div class="eyebrow" style="margin-bottom:16px">El pacto empieza aquí</div><h2>Reúne a tus cómplices.</h2><p>${r.visibility === "private" ? "Comparte el código. La mesa es solo para ustedes." : "Tu mesa aparece en las salas públicas."}</p></div><span class="pill">SALA ${r.visibility === "private" ? "PRIVADA" : "PÚBLICA"}</span></div><div class="lobby-grid"><div><div class="seats">${players.map((p) => `<div data-player="${p.playerId}" class="seat ${p.playerId === me.playerId ? "you" : ""}"><span class="avatar">${p.kind === "bot" ? "◇" : escape([...p.displayName][0].toUpperCase())}</span><div><strong>${escape(p.displayName)} ${p.playerId === me.playerId ? '<span class="gold">· tú</span>' : ""}</strong><small>${p.playerId === host ? "ANFITRIÓN · " : ""}${p.kind === "bot" ? "BOT · " : ""}${p.ready ? "✓ LISTO" : "SIN CONFIRMAR"}${!p.connected ? " · DESCONECTADO" : ""}</small></div>${can("room.removePlayer") && p.kind === "human" && p.playerId !== me.playerId ? `<button class="remove quiet" data-remove="${p.playerId}" aria-label="Retirar a ${escape(p.displayName)}">×</button>` : ""}</div>`).join("")}${Array.from({ length: r.config.totalPlayers - players.length }, () => `<div class="seat empty-seat"><span class="avatar">+</span><div><strong>Un asiento reservado</strong><small>ESPERANDO A UN HUMANO</small></div></div>`).join("")}</div><div class="status-bar">${v.public.lifecycle.hostSuccession ? `El anfitrión se ha desconectado. ${v.public.lifecycle.hostSuccession.state === "grace" ? "La mesa elegirá un sucesor al terminar su espera." : "Esperando a un anfitrión conectado."}<br>` : ""}Todos deben confirmar que están listos. El anfitrión decide cuándo comenzar.<br>Los bots ya están esperando su turno.</div></div><div class="panel">${v.self.privateCode ? `<label>CÓDIGO DE INVITACIÓN</label><div class="code-box"><b>${v.self.privateCode}</b><button id="copy-code" aria-label="Copiar código">Copiar</button></div>` : ""}${can("room.configure") ? `<form id="configure"><div class="field"><label for="lobby-visibility">Visibilidad</label><select id="lobby-visibility"><option value="private" ${draft.visibility === "private" ? "selected" : ""}>Solo con código</option><option value="public" ${draft.visibility === "public" ? "selected" : ""}>Sala pública</option></select></div><div class="form-grid"><div><label for="lobby-humans">Amigos, además de ti</label><select id="lobby-humans">${this.home.options(draft.additionalHumanPlayers)}</select></div><div><label for="lobby-bots">Bots</label><select id="lobby-bots">${this.home.options(draft.botPlayers)}</select></div></div><button class="full" ${disabled}>${this.home.pending("room.configure") ? "Enviando…" : "Guardar configuración"}</button><p class="command-feedback" role="status">${escape(commandMessage(this.store, "room.configure"))}</p></form><div style="height:25px"></div>` : `<h3>Una mesa de ${r.config.totalPlayers}</h3><p>${r.config.additionalHumanPlayers + 1} humanos · ${r.config.botPlayers} bots</p>`}<div class="button-stack"><button id="ready" class="${me.ready ? "" : "primary"}" ${disabled}>${this.home.pending("room.setReady") ? "Enviando…" : me.ready ? "✓ Estoy listo · Cancelar" : "Estoy listo"}</button><p class="command-feedback" role="status">${escape(commandMessage(this.store, "room.setReady"))}</p>${host === me.playerId ? `<button id="start" aria-describedby="start-reason" class="primary" ${can("room.start") ? disabled : "disabled"}>${this.home.pending("room.start") ? "Enviando…" : "Comenzar la partida →"}</button><p id="start-reason" class="form-help" role="status">${escape(commandMessage(this.store, "room.start") || this.startReason(v))}</p>` : ""}<button id="leave" class="quiet" ${disabled}>Abandonar la sala</button></div></div></div></section>` +
      this.home.footer());
    this.home.bindCommon(shell);
    shell.querySelector("#ready").onclick = () =>
      this.dispatch.send("room.setReady", { ready: !me.ready });
    const start = shell.querySelector("#start");
    if (start) start.onclick = () => this.dispatch.send("room.start");
    shell.querySelector("#leave").onclick = () =>
      this.dispatch.send("room.leave");
    shell
      .querySelectorAll("[data-remove]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            this.dispatch.send("room.removePlayer", {
              targetPlayerId: b.dataset.remove,
            })),
      );
    const copy = shell.querySelector("#copy-code");
    if (copy) copy.onclick = async (e) => {
      try {
        await navigator.clipboard.writeText(v.self.privateCode);
        e.target.textContent = "Copiado";
      } catch {
        e.target.textContent = v.self.privateCode;
      }
    };
    const configure = shell.querySelector("#configure");
    for (const [id, field] of [
      ["lobby-visibility", "visibility"],
      ["lobby-humans", "additionalHumanPlayers"],
      ["lobby-bots", "botPlayers"],
    ]) {
      const input = shell.querySelector(`#${id}`);
      if (input) input.onchange = () => {
        this.configDraft[field] = field === "visibility" ? input.value : Number(input.value);
        this.dirtyFields.add(field);
      };
    }
    if (configure) configure.onsubmit = (e) => {
      e.preventDefault();
      this.dispatch.send("room.configure", {
        visibility: shell.querySelector("#lobby-visibility").value,
        additionalHumanPlayers: Number(
          shell.querySelector("#lobby-humans").value,
        ),
        botPlayers: Number(shell.querySelector("#lobby-bots").value),
      });
    };
  }
  startReason(view) {
    if (!this.store.connected || this.store.reconnecting) return "Esperando conexión con la mesa.";
    const players = view.public.players;
    const missing = view.public.room.config.totalPlayers - players.length;
    if (missing > 0) return `Falta ocupar ${missing} ${missing === 1 ? "asiento" : "asientos"}.`;
    const waiting = players.filter((player) => player.kind === "human" && !player.ready);
    if (waiting.length) return `Falta confirmar: ${waiting.map((player) => player.displayName).join(", ")}.`;
    return "Todos están listos. Puedes comenzar la partida.";
  }
}
