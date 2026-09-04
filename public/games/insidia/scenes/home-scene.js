import { sins, conspiracies, errors } from "../ui/strings.js";
const logoUrl = new URL("../logo.webp", import.meta.url).href;
export const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
// Patch equivalent shell nodes in place so live snapshots cannot discard a
// focused field, caret, native select, or its in-progress value.
export function patchShell(root, html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  const key = (node) => node.nodeType === 1
    ? node.id || node.getAttribute("data-player") || node.getAttribute("data-join")
    : null;
  function patch(parent, desired) {
    let cursor = parent.firstChild;
    for (const next of [...desired.childNodes]) {
      let current = cursor;
      if (key(next)) current = [...parent.childNodes].find((node) => key(node) === key(next));
      if (!current || current.nodeType !== next.nodeType ||
          (next.nodeType === 1 && (current.tagName !== next.tagName || key(current) !== key(next)))) {
        current = next.cloneNode(true);
        parent.insertBefore(current, cursor);
      } else {
        if (current !== cursor) parent.insertBefore(current, cursor);
        if (next.nodeType === 3) {
          if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
        } else if (next.nodeType === 1) {
          const focused = current === document.activeElement;
          const value = focused && "value" in current ? current.value : null;
          for (const attr of [...current.attributes])
            if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
          for (const attr of [...next.attributes])
            if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
          patch(current, next);
          if ("value" in current && ["INPUT", "SELECT", "TEXTAREA"].includes(current.tagName)) {
            const targetValue = focused ? value : next.value;
            if (current.value !== targetValue) current.value = targetValue;
          }
        }
      }
      cursor = current.nextSibling;
    }
    while (cursor) {
      const remove = cursor;
      cursor = cursor.nextSibling;
      parent.removeChild(remove);
    }
  }
  patch(root, template.content);
}

export function commandMessage(store, type, origin = type) {
  if ([...store.pending.values()].some((entry) => (entry.origin ?? entry.command.type) === origin))
    return "Enviando…";
  const feedback = store.commandFeedback;
  if (feedback?.origin !== origin || feedback.status !== "rejected") return "";
  return errors[feedback.code] ?? ({
    DECISION_EXPIRED: "Tiempo agotado. Esperando a la mesa…",
    ACTION_NOT_ALLOWED: "Esta acción ya no está disponible.",
    INVALID_TARGET: "Elige uno de los destinos disponibles.",
    STALE_STATE: "La mesa cambió. Revisa tu elección.",
  })[feedback.code] ?? "No se pudo completar. Puedes volver a intentarlo.";
}

export class HomeScene {
  constructor(store, dispatch) {
    this.store = store;
    this.dispatch = dispatch;
    this.name = localStorage.getItem("insidia.name") ?? "";
    this.humans = 0;
    this.bots = 2;
    this.visibility = "public";
    this.code = "";
    this.tableModal = null;
  }
  header() {
    return `<header><button class="quiet" data-rules>Cómo jugar ↗</button></header>`;
  }
  footer() {
    return `<footer><span>Insidia · Reglas 2.2</span><span>De 3 a 6 almas. Ninguna inocente.</span></footer>`;
  }
  availableRooms() {
    return this.store.rooms.filter((room) => room.status === "lobby" &&
      room.occupiedHumanSeats < room.configuredHumanSeats);
  }
  tableSection(visibility) {
    const rooms = this.availableRooms().filter((room) => room.visibility === visibility);
    const label = visibility === "public" ? "Mesas públicas" : "Mesas privadas";
    return `<section id="${visibility}-tables" class="table-section" aria-labelledby="${visibility}-tables-title">
      <h3 id="${visibility}-tables-title">${label}<span>${rooms.length}</span></h3>
      ${rooms.length ? rooms.map((room) => `<button type="button" class="table-row" data-join="${escape(room.roomId)}" ${this.disabled()}>
        <span class="table-row-copy"><strong>${escape(room.hostDisplayName ?? "Esperando anfitrión")}</strong>
        <span>${room.occupiedHumanSeats} / ${room.configuredHumanSeats} humanos · ${room.botCount} bots</span></span>
        <span class="table-row-action">${visibility === "private" ? '<span class="table-lock" role="img" aria-label="Con código"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="8" width="12" height="9" rx="2"/><path d="M6 8V6a4 4 0 0 1 8 0v2"/></svg></span>' : '<span aria-hidden="true">→</span>'}</span>
      </button>`).join("") : `<p class="table-empty">No hay mesas ${visibility === "public" ? "públicas" : "privadas"} disponibles.</p>`}
    </section>`;
  }
  render() {
    const shell = document.getElementById("shell");
    document.body.classList.add("landing");
    patchShell(shell, `<section class="home-grid">
      <img class="landing-logo" src="${logoUrl}" alt="Insidia" decoding="async" fetchpriority="high">
      <section class="panel table-panel" aria-labelledby="table-panel-title">
        <div class="panel-top"><h2 id="table-panel-title">Tu lugar en la mesa</h2><small>INVITADO</small></div>
        <div class="table-directory" tabindex="0" role="region" aria-label="Mesas disponibles">
          ${this.tableSection("public")}${this.tableSection("private")}
        </div>
        <div class="table-panel-actions"><button type="button" data-create class="primary full" ${this.disabled()}>Crear mesa <span aria-hidden="true">＋</span></button>
          <button class="quiet full" type="button" data-rules>Cómo jugar ↗</button></div>
      </section></section>` + this.footer());
    this.bindCommon(shell);
    shell.querySelector("[data-create]").onclick = () => this.openTableDialog("create");
    shell.querySelectorAll("[data-join]").forEach((button) => {
      button.onclick = () => {
        const room = this.availableRooms().find((r) => r.roomId === button.dataset.join);
        if (room) this.openTableDialog("join", room);
      };
    });
    this.syncTableDialog();
  }
  openTableDialog(mode, room) {
    if (this.disabled()) return;
    const dialog = document.getElementById("table-dialog");
    this.tableReturnFocus = document.activeElement;
    this.tableModal = { mode, room: room ? { ...room } : null };
    this.code = "";
    if (mode === "create") {
      this.visibility = "public";
      this.humans = 0;
      this.bots = 2;
    }
    this.store.commandFeedback = null;
    dialog.oncancel = (event) => {
      event.preventDefault();
      this.closeTableDialog();
    };
    dialog.onkeydown = (event) => {
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled)")];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog.onclose = () => {
      if (!dialog.open && this.tableModal) this.closeTableDialog();
    };
    this.syncTableDialog();
    dialog.showModal();
    dialog.scrollTop = 0;
    dialog.querySelector("#display-name").focus({ preventScroll: true });
  }
  closeTableDialog({ restoreFocus = true } = {}) {
    if (!this.tableModal) return;
    this.tableModal = null;
    this.code = "";
    const dialog = document.getElementById("table-dialog");
    if (dialog?.open) dialog.close();
    if (dialog) document.getElementById("table-dialog-content").replaceChildren();
    if (restoreFocus) {
      const target = this.tableReturnFocus?.isConnected && !this.tableReturnFocus.disabled
        ? this.tableReturnFocus : document.querySelector("[data-create]");
      target?.focus({ preventScroll: true });
    }
    this.tableReturnFocus = null;
  }
  selectedTableAvailable() {
    const selected = this.tableModal?.room;
    return selected && this.availableRooms().some((room) =>
      room.roomId === selected.roomId && room.visibility === selected.visibility);
  }
  syncTableDialog() {
    if (!this.tableModal) return;
    if (this.store.view) {
      this.closeTableDialog({ restoreFocus: false });
      return;
    }
    const { mode, room } = this.tableModal;
    const creating = mode === "create";
    const privateJoin = !creating && room.visibility === "private";
    const type = creating ? "room.create" : privateJoin ? "room.joinPrivate" : "room.joinPublic";
    const origin = creating ? type : `${type}:${room.roomId}`;
    const unavailable = !creating && !this.selectedTableAvailable();
    const total = 1 + this.humans + this.bots;
    const invalidTotal = creating && (total < 3 || total > 6);
    const pending = this.pending(type, origin);
    const feedback = pending ? "Enviando…" : unavailable ? "Esta mesa ya no está disponible. Elige otra mesa." :
      !this.store.connected || this.store.reconnecting ? "Esperando conexión con la mesa…" :
      invalidTotal ? errors.INVALID_ROOM_CONFIG : commandMessage(this.store, type, origin);
    const target = document.getElementById("table-dialog-content");
    patchShell(target, `<div class="table-dialog-heading"><div><div class="eyebrow">${creating ? "Un nuevo pacto" : privateJoin ? "Mesa privada · Con código" : "Mesa pública"}</div>
        <h2 id="table-dialog-title">${creating ? "Crear mesa" : "Tomar asiento"}</h2></div>
        <button type="button" class="quiet table-dialog-close" data-close-table aria-label="Cerrar">×</button></div>
      ${creating ? "" : `<p class="table-dialog-host">${escape(room.hostDisplayName ?? "Esperando anfitrión")}</p>`}
      <form id="${creating ? "create-form" : "join-form"}">
        <div class="field"><label for="display-name">¿Cómo te llaman?</label><input id="display-name" name="displayName" autocomplete="nickname" maxlength="24" placeholder="Tu nombre" value="${escape(this.name)}" required></div>
        ${creating ? `<div class="field"><label for="visibility">La invitación</label><select id="visibility"><option value="public" ${this.visibility === "public" ? "selected" : ""}>Pública · Abierta a todos</option><option value="private" ${this.visibility === "private" ? "selected" : ""}>Privada · Con código</option></select></div>
          <div class="form-grid"><div><label for="humans">Amigos, además de ti</label><select id="humans">${this.options(this.humans)}</select></div><div><label for="bots">Oponentes bot</label><select id="bots">${this.options(this.bots)}</select></div></div>
          <div class="total"><span>Tú + tus invitados</span><strong id="total">${total} jugadores</strong></div>` : privateJoin ? `<div class="field"><label for="private-code">El código de seis dígitos</label><input id="private-code" name="code" inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]{6}" required placeholder="000000" value="${escape(this.code)}" aria-describedby="table-form-help"></div>` : ""}
        <button class="primary full" type="submit" aria-describedby="table-command-feedback" ${unavailable || invalidTotal ? "disabled" : this.disabled()}>${pending ? "Enviando…" : creating ? "Crear la mesa →" : "Entrar a la mesa →"}</button>
        <p id="table-command-feedback" class="command-feedback" role="status">${escape(feedback)}</p>
        <p id="table-form-help" class="form-help">${creating ? "Juega ahora con bots o invita a tus cómplices." : privateJoin ? "Pídele el código al anfitrión." : "Tu asiento te espera."}</p>
      </form>`);
    target.querySelector("[data-close-table]").onclick = () => this.closeTableDialog();
    target.querySelector("#display-name").oninput = (event) => {
      this.name = event.target.value;
      event.target.setCustomValidity("");
      localStorage.setItem("insidia.name", this.name);
    };
    if (creating) {
      target.querySelector("#visibility").onchange = (event) => {
        this.visibility = event.target.value;
      };
      for (const field of ["humans", "bots"]) {
        target.querySelector("#" + field).onchange = (event) => {
          this[field] = Number(event.target.value);
          this.syncTableDialog();
        };
      }
    } else if (privateJoin) {
      target.querySelector("#private-code").oninput = (event) => {
        this.code = event.target.value.replace(/\D/g, "").slice(0, 6);
        event.target.value = this.code;
      };
    }
    target.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      if (this.disabled() || (!creating && !this.selectedTableAvailable()) || invalidTotal || !this.requireName()) return;
      if (!event.target.reportValidity()) return;
      const payload = { displayName: this.name.trim() };
      if (creating) Object.assign(payload, {
        visibility: this.visibility,
        additionalHumanPlayers: this.humans,
        botPlayers: this.bots,
      });
      else if (privateJoin) payload.code = this.code;
      this.dispatch.send(type, payload, room?.roomId, origin);
      this.syncTableDialog();
    };
  }
  pending(type, origin = type) {
    return [...this.store.pending.values()].some((entry) => (entry.origin ?? entry.command.type) === origin);
  }
  disabled() {
    return !this.store.connected || this.store.reconnecting || this.store.pending.size ? "disabled" : "";
  }
  options(value) {
    return Array.from(
      { length: 6 },
      (_, i) =>
        `<option ${i === value ? "selected" : ""} value="${i}">${i}</option>`,
    ).join("");
  }
  requireName() {
    const field = document.getElementById("display-name");
    if (this.name.replace(/[\p{Cc}\p{Cf}]/gu, "").trim()) return true;
    field.setCustomValidity("Escribe tu nombre para entrar");
    field.focus();
    field.reportValidity();
    return false;
  }
  bindCommon(root) {
    root.querySelectorAll("[data-rules]").forEach((button) =>
      (button.onclick = () => this.showRules()));
  }
  showRules() {
    const target = document.getElementById("rules-content");
    target.innerHTML = `<div class="eyebrow">El arte de la insidia</div><h2 style="margin-top:16px">Confía en nadie.</h2><p>Gana al resolver <strong class="gold">Orgullo</strong> sin que lo bloqueen, o al ser el último jugador con menos de dos pecados expuestos. Empiezas con 2 almas y 2 pecados ocultos.</p><h3>En tu turno, elige una acción</h3><p>Tomar hasta <strong>2 almas</strong> · Conspirar por <strong>1 alma</strong> · Forzar un descarte al azar por <strong>8 almas</strong> · Declarar un pecado.</p><p>Puedes declarar cualquier pecado que puedas pagar, aunque no esté en tu mano. Los demás deciden si desafiarte, por turnos. Si mentías, revelas un pecado al azar y tu acción termina sin pagar. Si decías la verdad, el desafiante revela uno y tu efecto continúa. Al terminar, las manos vuelven a dos cartas; quien tenga dos o más pecados expuestos queda eliminado.</p><div class="rules-grid">${Object.values(
      sins,
    )
      .map(
        (s) =>
          `<div class="rule-card"><h3 style="color:${s.color}">${s.symbol} ${s.name} <small>${s.cost} ALMAS</small></h3><p>${s.description}</p></div>`,
      )
      .join(
        "",
      )}</div><h3>Las seis conspiraciones</h3><div class="rules-grid">${Object.values(
      conspiracies,
    )
      .map(
        ([name, description]) =>
          `<div class="rule-card"><h3>${name}</h3><p>${description}</p></div>`,
      )
      .join(
        "",
      )}</div><p>Tienes 60 segundos para tu turno, 15 para desafiar o bloquear y 30 para elegir. Si no respondes, tomas almas, pasas o el servidor elige por ti, según la decisión.</p>`;
    const dialog = document.getElementById("rules");
    dialog.onclose = null;
    dialog.removeAttribute("aria-labelledby");
    dialog.removeAttribute("aria-modal");
    dialog.removeAttribute("data-mode");
    const inMatch = ["active", "finished"].includes(this.store.view?.public.room.status);
    if (inMatch) {
      dialog.showModal();
      return;
    }
    if (dialog.open) return;
    target.querySelector("h2").id = "rules-title";
    this.rulesReturnFocus = document.activeElement;
    dialog.setAttribute("aria-labelledby", "rules-title");
    dialog.setAttribute("aria-modal", "true");
    dialog.dataset.mode = "modal";
    dialog.onclose = () => {
      this.rulesScroll = dialog.scrollTop;
      if (this.rulesReturnFocus?.isConnected)
        this.rulesReturnFocus.focus({ preventScroll: true });
    };
    dialog.showModal();
    dialog.scrollTop = this.rulesScroll ?? 0;
  }
}
