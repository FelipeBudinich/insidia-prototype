import { sins, conspiracies } from "../ui/strings.js";
export const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export class HomeScene {
  constructor(store, dispatch) {
    this.store = store;
    this.dispatch = dispatch;
    this.tab = "create";
    this.screen = "home";
    this.name = localStorage.getItem("insidia.name") ?? "";
    this.humans = 0;
    this.bots = 2;
    this.visibility = "private";
    this.code = "";
  }
  header() {
    return `<header><div class="wordmark"><span class="brand-symbol"><b>I</b></span>INSIDIA</div><div class="header-right"><span class="online-label"><i class="live-dot"></i>UN JUEGO DE CONFIANZA Y TRAICIÓN</span><button class="quiet" data-rules>Cómo jugar ↗</button></div></header>`;
  }
  footer() {
    return `<footer><span>Insidia · Reglas 2.2</span><span>De 3 a 6 almas. Ninguna inocente.</span></footer>`;
  }
  render() {
    const shell = document.getElementById("shell");
    if (this.screen === "browser") {
      this.browser(shell);
      return;
    }
    shell.innerHTML =
      this.header() +
      `<section class="home-grid"><div class="home-intro"><div class="eyebrow">Un pacto. Ocho pecados. Una victoria.</div><h1>INSIDIA</h1><div class="lead">Ningún alma es inocente.</div><p>Oculta tus pecados. Acumula almas.<br>Haz que todos crean tu mentira…<br>o atrévete a desenmascarar la suya.</p><div class="card-fan" aria-hidden="true">${["RABIA", "ORGULLO", "VANIDAD"].map((s, i) => `<div class="preview-card"><div class="line"></div><div class="roman">${["II", "I", "VI"][i]}</div><div class="glyph">${sins[s].symbol}</div><div class="title">${sins[s].name.toUpperCase()}</div></div>`).join("")}</div><div class="home-stats"><span>3—6 jugadores</span><span>Humanos + bots</span><span>Una mesa, en tiempo real</span></div></div><section class="panel"><div class="panel-top"><h3>Tu lugar en la mesa</h3><small>INVITADO</small></div><div class="field"><label for="display-name">¿Cómo te llaman?</label><input id="display-name" name="displayName" autocomplete="nickname" maxlength="24" placeholder="Tu nombre" value="${escape(this.name)}"></div><div class="tabs"><button data-tab="create" class="${this.tab === "create" ? "active" : ""}">Crear una sala</button><button data-tab="join" class="${this.tab === "join" ? "active" : ""}">Tengo un código</button></div>${this.tab === "create" ? `<form id="create-form"><div class="field"><label for="visibility">La invitación</label><select id="visibility"><option value="private" ${this.visibility === "private" ? "selected" : ""}>Privada · Solo con código</option><option value="public" ${this.visibility === "public" ? "selected" : ""}>Pública · Abierta a todos</option></select></div><div class="form-grid"><div><label for="humans">Amigos, además de ti</label><select id="humans">${this.options(this.humans)}</select></div><div><label for="bots">Oponentes bot</label><select id="bots">${this.options(this.bots)}</select></div></div><div class="total"><span>Tú + tus invitados</span><strong id="total">${1 + this.humans + this.bots} jugadores</strong></div><button class="primary full" type="submit" ${this.disabled()}>Crear la mesa <span style="float:right">→</span></button><p class="form-help">Juega ahora con bots o invita a tus cómplices.</p></form>` : `<form id="join-form"><label for="private-code">El código de seis dígitos</label><input id="private-code" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" required placeholder="000000" value="${escape(this.code)}" style="font-size:30px;letter-spacing:.25em;text-align:center;margin:8px 0 25px"><button class="primary full" ${this.disabled()}>Entrar a la mesa →</button><p class="form-help">Pídele el código al anfitrión.</p></form>`}<button data-browse class="quiet full" style="margin-top:21px;border-top:1px solid var(--line);padding-top:21px">Explorar salas públicas ↗</button></section></section>` +
      this.footer();
    this.bindCommon(shell);
    shell.querySelector("#display-name").oninput = (e) => {
      this.name = e.target.value;
      localStorage.setItem("insidia.name", this.name);
    };
    shell.querySelectorAll("[data-tab]").forEach(
      (b) =>
        (b.onclick = () => {
          this.tab = b.dataset.tab;
          this.render();
        }),
    );
    shell.querySelector("[data-browse]").onclick = () => {
      this.screen = "browser";
      this.render();
    };
    if (this.tab === "create") {
      shell.querySelector("#visibility").onchange = (e) =>
        (this.visibility = e.target.value);
      for (const field of ["humans", "bots"])
        shell.querySelector("#" + field).onchange = (e) => {
          this[field] = Number(e.target.value);
          shell.querySelector("#total").textContent =
            `${1 + this.humans + this.bots} jugadores`;
        };
      shell.querySelector("#create-form").onsubmit = (e) => {
        e.preventDefault();
        if (!this.requireName()) return;
        this.dispatch.send("room.create", {
          visibility: this.visibility,
          displayName: this.name.trim(),
          additionalHumanPlayers: this.humans,
          botPlayers: this.bots,
        });
      };
    } else {
      shell.querySelector("#private-code").oninput = (e) =>
        (this.code = e.target.value.replace(/\D/g, "").slice(0, 6));
      shell.querySelector("#join-form").onsubmit = (e) => {
        e.preventDefault();
        if (this.requireName())
          this.dispatch.send("room.joinPrivate", {
            displayName: this.name.trim(),
            code: this.code,
          });
      };
    }
  }
  disabled() {
    return !this.store.connected || this.store.pending.size ? "disabled" : "";
  }
  options(value) {
    return Array.from(
      { length: 6 },
      (_, i) =>
        `<option ${i === value ? "selected" : ""} value="${i}">${i}</option>`,
    ).join("");
  }
  requireName() {
    if (this.name.trim()) return true;
    const field = document.getElementById("display-name");
    if (field) {
      field.focus();
      field.reportValidity();
      field.placeholder = "Escribe tu nombre para entrar";
    } else {
      this.screen = "home";
      this.render();
      document.getElementById("display-name").focus();
    }
    return false;
  }
  bindCommon(root) {
    root
      .querySelectorAll("[data-rules]")
      .forEach((b) => (b.onclick = () => this.showRules()));
  }
  browser(shell) {
    shell.innerHTML =
      this.header() +
      `<section><div class="browser-header"><div><div class="eyebrow" style="margin-bottom:16px">Hay sitio para una mentira más</div><h2>Salas públicas</h2></div><button data-home>← Volver</button></div><div class="rooms">${this.store.rooms.length ? this.store.rooms.map((r) => `<article class="room-card"><span class="eyebrow">MESA ABIERTA</span><h3>${escape(r.hostDisplayName ?? "Esperando anfitrión")}</h3><p>${r.occupiedHumanSeats} / ${r.configuredHumanSeats} humanos · ${r.botCount} bots<br>${r.connectedHumanCount} conectados</p><button class="primary full" data-join="${r.roomId}" ${r.occupiedHumanSeats >= r.configuredHumanSeats ? "disabled" : this.disabled()}>${r.occupiedHumanSeats >= r.configuredHumanSeats ? "Mesa completa" : "Tomar asiento →"}</button></article>`).join("") : `<div class="empty"><span class="gold" style="font-size:45px">◇</span><h3>La primera mesa puede ser tuya.</h3><p>No hay salas públicas todavía. Crea una e invita a jugar.</p><button data-new class="primary">Crear una sala pública</button></div>`}</div></section>` +
      this.footer();
    this.bindCommon(shell);
    shell.querySelector("[data-home]").onclick = () => {
      this.screen = "home";
      this.render();
    };
    shell.querySelector("[data-new]")?.addEventListener("click", () => {
      this.screen = "home";
      this.visibility = "public";
      this.render();
    });
    shell.querySelectorAll("[data-join]").forEach(
      (b) =>
        (b.onclick = () => {
          if (this.requireName())
            this.dispatch.send(
              "room.joinPublic",
              { displayName: this.name.trim() },
              b.dataset.join,
            );
        }),
    );
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
      )}</div><p>El banco contiene 60 almas en total: los pagos siempre vuelven a él. No hay deuda. Tienes 60 segundos para tu turno, 15 para desafiar o bloquear y 30 para elegir. Si no respondes, tomas almas, pasas o el servidor elige por ti, según la decisión.</p>`;
    document.getElementById("rules").showModal();
  }
}
