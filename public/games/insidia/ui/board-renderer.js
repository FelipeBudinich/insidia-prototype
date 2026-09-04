import { sins, conspiracies, purposes, effectText } from "./strings.js";
import { assets } from "../media/assets.js";
import { DESIGN_HEIGHT, DESIGN_WIDTH } from "../resolution.js";
import { drawImageAsset } from "./card-art.js";
const CARD_RATIOS = {
  sin: { width: 5, height: 7 },
  conspiracy: { width: 7, height: 5 },
};
const CONSPIRACY_REVEAL_MS = 1500;
const REVEALED_CONSPIRACY = { x: 600, y: 255, w: 400 };
function cardBounds(kind, x, y, w) {
  const ratio = CARD_RATIOS[kind];
  return { x, y, w, h: (w * ratio.height) / ratio.width };
}
const P = {
  bg: "#16151b",
  panel: "#211e28",
  line: "#413846",
  gold: "#d2b478",
  ink: "#eee7da",
  muted: "#aaa0b1",
  green: "#93b6a0",
  red: "#ce837b",
};
export class BoardRenderer {
  constructor(store, dispatch, home, cardAssets = assets) {
    this.store = store;
    this.dispatch = dispatch;
    this.home = home;
    this.cardAssets = cardAssets;
    this.regions = [];
    this.selected = [];
    this.modal = null;
    this.hover = null;
    this.signature = "";
    this.lastOpportunity = null;
    this.revealRoomId = null;
    this.lastConspiracyEffectSeq = null;
    this.transientConspiracy = null;
    this.announcedConspiracyKey = null;
  }
  rect(x, y, w, h, fill, stroke, r = 8) {
    const c = this.ctx;
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 1;
      c.stroke();
    }
  }
  artworkShade(x, y, w, h, r) {
    const c = this.ctx,
      top = c.createLinearGradient(x, y, x, y + h * 0.34),
      bottom = c.createLinearGradient(x, y + h * 0.42, x, y + h);
    top.addColorStop(0, "#080609e6");
    top.addColorStop(1, "#08060900");
    bottom.addColorStop(0, "#08060900");
    bottom.addColorStop(0.48, "#080609b8");
    bottom.addColorStop(1, "#080609f5");
    c.save();
    c.beginPath();
    c.roundRect(x, y, w, h, r);
    c.clip();
    c.fillStyle = top;
    c.fillRect(x, y, w, h * 0.34);
    c.fillStyle = bottom;
    c.fillRect(x, y + h * 0.42, w, h * 0.58);
    c.restore();
  }
  text(t, x, y, size = 16, color = P.ink, align = "left", serif = false) {
    const c = this.ctx;
    c.font = `${size}px ${serif ? "Georgia, serif" : "Arial, sans-serif"}`;
    c.textAlign = align;
    c.textBaseline = "middle";
    c.fillStyle = color;
    c.fillText(String(t), x, y);
  }
  wrap(t, x, y, width, size = 15, color = P.muted, line = 23, align = "left") {
    const words = t.split(" ");
    let text = "",
      row = 0;
    this.ctx.font = `${size}px Arial`;
    for (const word of words) {
      if (this.ctx.measureText(text + word).width > width && text) {
        this.text(text.trim(), x, y + row++ * line, size, color, align);
        text = "";
      }
      text += word + " ";
    }
    if (text) this.text(text.trim(), x, y + row * line, size, color, align);
    return (row + 1) * line;
  }
  button(id, label, x, y, w, h, fn, primary = false, disabled = false) {
    const hover = this.hover === id;
    this.rect(
      x,
      y,
      w,
      h,
      disabled ? "#24202b" : primary ? P.gold : hover ? "#3d3345" : "#292330",
      disabled ? "#3b3441" : primary ? P.gold : hover ? P.gold : "#5c4e63",
      5,
    );
    this.text(
      label,
      x + w / 2,
      y + h / 2,
      16,
      disabled ? "#625869" : primary ? "#211c17" : P.ink,
      "center",
    );
    if (!disabled) this.regions.push({ id, label, x, y, w, h, fn });
  }
  card(
    sin,
    x,
    y,
    w,
    {
      back = false,
      selected = false,
      exposed = false,
      small = false,
      order,
    } = {},
  ) {
    const bounds = cardBounds("sin", x, y, w),
      { h } = bounds,
      c = this.ctx,
      s = sins[sin],
      color = back ? "#807051" : s.color;
    c.save();
    this.rect(
      x,
      y,
      w,
      h,
      back ? "#25212c" : exposed ? "#302326" : "#2b2631",
      selected ? P.gold : color,
      7,
    );
    this.rect(
      x + 7,
      y + 7,
      w - 14,
      h - 14,
      null,
      back ? "#5e513e" : color + "66",
      3,
    );
    if (back) {
      if (
        !drawImageAsset(this.ctx, this.cardAssets.pecadoBack, x, y, w, h, 7)
      ) {
        c.strokeStyle = "#65553d";
        c.lineWidth = 1;
        for (let i = 1; i < 5; i++) {
          const d = (Math.min(w, h) * i) / 10;
          c.beginPath();
          c.moveTo(x + w / 2, y + h / 2 - d * 1.5);
          c.lineTo(x + w / 2 + d, y + h / 2);
          c.lineTo(x + w / 2, y + h / 2 + d * 1.5);
          c.lineTo(x + w / 2 - d, y + h / 2);
          c.closePath();
          c.stroke();
        }
        this.text("I", x + w / 2, y + h / 2, w * 0.34, P.gold, "center", true);
      }
    } else if (
      drawImageAsset(
        this.ctx,
        this.cardAssets.pecadoFronts?.[sin],
        x,
        y,
        w,
        h,
        7,
      )
    ) {
      this.artworkShade(x, y, w, h, 7);
      this.text(
        Object.keys(sins).indexOf(sin) + 1,
        x + 12,
        y + 15,
        small ? 8 : 10,
        color,
      );
      this.text(
        s.cost + " ◇",
        x + w - 12,
        y + 15,
        small ? 9 : 11,
        color,
        "right",
      );
      this.text(
        s.symbol,
        x + w / 2,
        y + h * 0.64,
        w * 0.2,
        color,
        "center",
        true,
      );
      this.text(
        s.name.toUpperCase(),
        x + w / 2,
        y + h * 0.76,
        small ? 13 : 17,
        color,
        "center",
        true,
      );
      this.text(
        s.motto,
        x + w / 2,
        y + h * 0.86,
        small ? 7 : 9,
        P.ink,
        "center",
      );
      this.text(
        exposed ? "EXPUESTO" : "PECADO",
        x + w / 2,
        y + h * 0.95,
        small ? 6 : 8,
        color,
        "center",
      );
    } else {
      this.text(
        Object.keys(sins).indexOf(sin) + 1,
        x + 15,
        y + 20,
        small ? 9 : 11,
        color,
      );
      this.text(
        s.cost + " ◇",
        x + w - 15,
        y + 20,
        small ? 10 : 12,
        color,
        "right",
      );
      this.text(
        s.symbol,
        x + w / 2,
        y + h * 0.43,
        w * 0.39,
        color,
        "center",
        true,
      );
      this.text(
        s.name.toUpperCase(),
        x + w / 2,
        y + h * 0.71,
        small ? 11 : 18,
        color,
        "center",
        true,
      );
      if (!small) {
        this.text(s.motto, x + w / 2, y + h * 0.83, 9, P.muted, "center");
        this.text(
          exposed ? "EXPUESTO" : "PECADO",
          x + w / 2,
          y + h * 0.93,
          8,
          color,
          "center",
        );
      }
    }
    this.rect(x, y, w, h, null, selected ? P.gold : color, 7);
    if (selected) {
      this.rect(x + w - 31, y - 10, 27, 27, P.gold, null, 14);
      this.text(order ?? "✓", x + w - 17, y + 4, 14, "#211c17", "center");
    }
    c.restore();
    return bounds;
  }
  conspiracyCard(x, y, w, conspiracy = null) {
    const bounds = cardBounds("conspiracy", x, y, w),
      { h } = bounds;
    this.rect(x, y, w, h, "#29212d", "#74566c", 6);
    if (conspiracy) {
      const [name, description] = conspiracies[conspiracy],
        hasArtwork = drawImageAsset(
          this.ctx,
          this.cardAssets.conspiracyFronts?.[conspiracy],
          x,
          y,
          w,
          h,
          6,
          "cover",
        );
      if (hasArtwork) this.artworkShade(x, y, w, h, 6);
      else {
        this.rect(x + 8, y + 8, w - 16, h - 16, null, "#594254", 3);
        this.text("✧", x + w / 2, y + h * 0.39, 70, "#ba96b5", "center", true);
      }
      this.text(
        "CONSPIRACIÓN REVELADA",
        x + w / 2,
        y + 21,
        10,
        P.gold,
        "center",
      );
      this.text(
        name.toUpperCase(),
        x + w / 2,
        y + h * 0.72,
        25,
        P.ink,
        "center",
        true,
      );
      this.wrap(
        description,
        x + w / 2,
        y + h * 0.82,
        w - 48,
        11,
        P.ink,
        16,
        "center",
      );
      this.rect(x, y, w, h, null, P.gold, 6);
    } else if (
      !drawImageAsset(
        this.ctx,
        this.cardAssets.conspiracyBack,
        x,
        y,
        w,
        h,
        6,
      )
    ) {
      this.rect(x + 7, y + 7, w - 14, h - 14, null, "#594254", 3);
      this.text("✧", x + w / 2, y + h * 0.4, 50, "#ba96b5", "center", true);
      this.text(
        "CONSPIRACIÓN",
        x + w / 2,
        y + h * 0.77,
        8,
        "#ba96b5",
        "center",
      );
    }
    return bounds;
  }
  currentConspiracy(v) {
    const effects = v.public.recentEffects ?? [],
      latest = [...effects]
        .reverse()
        .find((effect) => effect.kind === "conspiracyRevealed"),
      roomChanged = this.revealRoomId !== v.roomId;
    if (roomChanged) {
      this.revealRoomId = v.roomId;
      this.lastConspiracyEffectSeq = latest?.effectSeq ?? null;
      this.transientConspiracy = null;
      this.announcedConspiracyKey = null;
      const announcer = document.getElementById("game-announcer");
      if (announcer?.textContent) announcer.textContent = "";
    } else if (
      latest &&
      latest.effectSeq !== this.lastConspiracyEffectSeq
    ) {
      this.lastConspiracyEffectSeq = latest.effectSeq;
      this.transientConspiracy = {
        conspiracy: latest.conspiracy,
        effectSeq: latest.effectSeq,
        expiresAt: this.store.now() + CONSPIRACY_REVEAL_MS,
      };
    }

    const active = v.public.board.revealedConspiracy?.conspiracy;
    if (active) {
      const matchingEffect = latest?.conspiracy === active ? latest : null;
      return {
        conspiracy: active,
        key: matchingEffect?.effectSeq ?? `active:${active}`,
      };
    }
    if (
      this.transientConspiracy &&
      this.store.now() < this.transientConspiracy.expiresAt
    ) {
      return {
        conspiracy: this.transientConspiracy.conspiracy,
        key: this.transientConspiracy.effectSeq,
      };
    }
    this.transientConspiracy = null;
    return null;
  }
  announceConspiracy(reveal) {
    if (!reveal) return;
    const key = `${this.revealRoomId}:${reveal.key}`;
    if (key === this.announcedConspiracyKey) return;
    this.announcedConspiracyKey = key;
    const announcer = document.getElementById("game-announcer"),
      [name, description] = conspiracies[reveal.conspiracy];
    if (announcer)
      announcer.textContent = `Conspiración revelada: ${name}. ${description}`;
  }
  player(p, x, y, isActive, isResponder) {
    const w = 210,
      h = 100,
      c = this.ctx;
    this.rect(
      x - w / 2,
      y - h / 2,
      w,
      h,
      p.status === "eliminated" ? "#1a181e" : P.panel,
      isActive ? P.gold : isResponder ? P.red : P.line,
      8,
    );
    if (isActive) {
      c.fillStyle = P.gold;
      c.beginPath();
      c.arc(x - w / 2 + 19, y - h / 2 + 21, 3, 0, Math.PI * 2);
      c.fill();
    }
    this.text(
      p.displayName.length > 19
        ? p.displayName.slice(0, 18) + "…"
        : p.displayName,
      x,
      y - 24,
      20,
      p.status === "eliminated" ? "#736a79" : P.ink,
      "center",
      true,
    );
    this.text(
      p.status === "eliminated"
        ? "ELIMINADO"
        : `${p.kind === "bot" ? "BOT · " : ""}${p.connected ? "EN LA MESA" : "DESCONECTADO"}`,
      x,
      y,
      9,
      P.muted,
      "center",
    );
    this.text(`${p.souls} ◇`, x - 51, y + 25, 20, P.gold, "center");
    const mini = cardBounds("sin", 0, 0, 15);
    for (let i = 0; i < p.handCount; i++) {
      const cardX = x + 12 + i * 18;
      if (
        !drawImageAsset(
          this.ctx,
          this.cardAssets.pecadoBack,
          cardX,
          y + 12,
          mini.w,
          mini.h,
          2,
        )
      )
        this.rect(cardX, y + 12, mini.w, mini.h, "#39313f", "#817252", 2);
    }
    p.faceUpSins.forEach((card, i) => {
      this.rect(
        x - w / 2 + i * 85 + 20,
        y + h / 2 + 7,
        80,
        24,
        "#37262b",
        "#76504e",
        3,
      );
      this.text(
        sins[card.sin].name,
        x - w / 2 + i * 85 + 60,
        y + h / 2 + 19,
        11,
        P.red,
        "center",
      );
    });
  }
  draw(ctx) {
    this.ctx = ctx;
    this.regions = [];
    const v = this.store.view;
    if (!v || !["active", "finished"].includes(v.public.room.status)) return;
    const { public: pub, self } = v,
      players = pub.players,
      me = players.find((p) => p.playerId === self.playerId),
      board = pub.board,
      phase = pub.turn.phase;
    const opportunity =
      self.prompt?.promptId ??
      pub.interaction?.interactionId ??
      pub.turn.turnNumber + phase;
    if (this.lastOpportunity !== opportunity) {
      this.selected = [];
      this.modal = null;
      this.lastOpportunity = opportunity;
    }
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    const gradient = ctx.createRadialGradient(800, 365, 20, 800, 365, 680);
    gradient.addColorStop(0, "#302432");
    gradient.addColorStop(1, P.bg);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 80, DESIGN_WIDTH, 600);
    this.text("INSIDIA", 38, 40, 27, P.gold, "left", true);
    this.text("NINGÚN ALMA ES INOCENTE", 205, 42, 10, P.muted);
    this.rect(36, 77, 1528, 1, P.line);
    this.text(`TURNO ${pub.turn.turnNumber}`, 800, 39, 12, P.gold, "center");
    this.text(
      "◈  " +
        (pub.room.status === "finished"
          ? "PARTIDA TERMINADA"
          : pub.room.visibility === "private"
            ? "MESA PRIVADA"
            : "MESA PÚBLICA"),
      1140,
      40,
      11,
      P.muted,
      "right",
    );
    this.button("rules", "Cómo jugar ↗", 1395, 20, 169, 38, () =>
      this.home.showRules(),
    );
    ctx.strokeStyle = "#62503955";
    ctx.lineWidth = 1;
    for (const size of [0, 12]) {
      ctx.beginPath();
      ctx.ellipse(800, 375, 520 + size, 232 + size, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Public seats follow the immutable clockwise seat order, with this viewer at bottom.
    const n = players.length;
    for (let offset = 1; offset < n; offset++) {
      const p = players[(me.seatIndex + offset) % n],
        angle = Math.PI / 2 + (offset * Math.PI * 2) / n;
      this.player(
        p,
        800 + Math.cos(angle) * 528,
        365 + Math.sin(angle) * 251,
        p.playerId === pub.turn.activePlayerId,
        p.playerId === pub.interaction?.currentResponderId,
      );
    }
    const revealedConspiracy = this.currentConspiracy(v);
    this.announceConspiracy(revealedConspiracy);
    if (revealedConspiracy) {
      this.conspiracyCard(
        REVEALED_CONSPIRACY.x,
        REVEALED_CONSPIRACY.y,
        REVEALED_CONSPIRACY.w,
        revealedConspiracy.conspiracy,
      );
    } else {
      this.text("EL BANCO", 800, 265, 10, P.muted, "center");
      this.text(board.soulBank + "", 800, 308, 47, P.gold, "center", true);
      this.text("ALMAS", 800, 342, 9, P.gold, "center");
      this.card(null, 633, 286, 100, { back: true });
      this.text(
        board.sinDeckCount + " PECADOS",
        683,
        443,
        9,
        P.muted,
        "center",
      );
      this.conspiracyCard(847, 306, 140);
      this.text(
        board.conspiracyDeckCount + " CONSPIRACIONES",
        917,
        443,
        9,
        P.muted,
        "center",
      );
    }
    if (board.resolvingSin) {
      this.rect(650, 220, 300, 29, "#372d26", "#78623e");
      this.text(
        "DEMOSTRADO · " + sins[board.resolvingSin.sin].name.toUpperCase(),
        800,
        235,
        11,
        P.gold,
        "center",
      );
    }
    this.text("LO QUE SE SABE", 35, 122, 10, P.gold);
    pub.recentEffects.slice(-8).forEach((e, i) => {
      const y = 156 + i * 44;
      this.wrap(
        effectText(e, players),
        35,
        y,
        205,
        11,
        i === 7 ? P.ink : "#938698",
        16,
      );
    });
    if (board.publicCenter.length) {
      this.text("PECADOS REVELADOS", 35, 542, 9, P.red);
      const counts = {};
      for (const c of board.publicCenter)
        counts[c.sin] = (counts[c.sin] ?? 0) + 1;
      Object.entries(counts).forEach(([sin, count], i) =>
        this.text(
          `${sins[sin].name} × ${count}`,
          35,
          566 + i * 18,
          11,
          P.muted,
        ),
      );
    }
    let status =
      pub.turn.activePlayerId === self.playerId
        ? "Es tu turno. Haz tu jugada."
        : `El turno de ${players.find((p) => p.playerId === pub.turn.activePlayerId)?.displayName ?? ""}`;
    if (pub.interaction?.kind === "challenge")
      status = `${players.find((p) => p.playerId === pub.interaction.actorPlayerId)?.displayName} declara ${sins[pub.interaction.declaredSin].name}`;
    if (pub.interaction?.kind === "counter")
      status = `¿Alguien bloquea ${sins[pub.interaction.declaredSin].name}?`;
    if (self.prompt)
      status = self.prompt.submitted
        ? "Tu elección está sellada."
        : purposes[self.prompt.purpose];
    else if (pub.interaction?.kind === "prompt")
      status = `${players.find((p) => p.playerId === pub.interaction.playerId)?.displayName} está eligiendo…`;
    else if (pub.interaction?.kind === "simultaneousCards")
      status = "Cada alma está eligiendo su pecado…";
    if (me.status === "eliminated")
      status = "Tus pecados te delataron. Observa la partida.";
    if (pub.room.status === "finished") status = "El pacto ha terminado.";
    this.rect(470, 553, 660, 60, "#211b27", "#4e4055", 6);
    this.text(status, 800, 576, 21, P.ink, "center", true);
    const seconds = pub.turn.deadline
      ? Math.max(
          0,
          Math.ceil((Date.parse(pub.turn.deadline) - this.store.now()) / 1000),
        )
      : null;
    this.text(
      seconds === null
        ? ""
        : `${seconds} s  ·  ${self.legalActions.length ? "TU DECISIÓN" : "ESPERANDO"}`,
      800,
      599,
      9,
      seconds < 10 ? P.red : P.muted,
      "center",
    );
    this.rect(30, 645, 1540, 1, P.line);
    this.text(me.displayName, 40, 689, 29, P.ink, "left", true);
    this.text("TU ALMA", 40, 662, 9, P.muted);
    this.text(`${me.souls} ◇`, 40, 739, 40, P.gold, "left", true);
    this.text(
      `${me.faceUpSins.length} / 2 pecados expuestos`,
      40,
      778,
      12,
      me.faceUpSins.length ? P.red : P.muted,
    );
    me.faceUpSins.forEach((card, i) =>
      this.text(sins[card.sin].name, 40, 810 + i * 22, 16, P.red, "left", true),
    );
    this.text(
      me.status === "eliminated" ? "ELIMINADO" : "SOLO TÚ VES ESTAS CARTAS",
      800,
      667,
      9,
      P.muted,
      "center",
    );
    const hand = self.hand,
      w = 132,
      gap = 19,
      total = hand.length * w + (hand.length - 1) * gap;
    hand.forEach((card, i) => {
      const x = 800 - total / 2 + i * (w + gap),
        y = 690,
        selected = this.selected.includes(card.handCardRef),
        eligible = self.prompt?.eligibleHandCardRefs?.includes(
          card.handCardRef,
        );
      const bounds = this.card(card.sin, x, y, w, {
        selected,
        order: selected
          ? this.selected.indexOf(card.handCardRef) + 1
          : undefined,
      });
      if (eligible && !self.prompt.submitted && !this.store.pending.size)
        this.regions.push({
          id: "hand:" + card.handCardRef,
          label: `Seleccionar ${sins[card.sin].name}`,
          ...bounds,
          fn: () => this.selectCard(card.handCardRef),
        });
      else
        this.regions.push({
          id: "info:" + card.handCardRef,
          label: `Leer ${sins[card.sin].name}`,
          ...bounds,
          fn: () => {
            this.modal = { kind: "info", sin: card.sin };
          },
        });
    });
    const actions = self.legalActions,
      find = (t) => actions.find((a) => a.type === t),
      busy = this.store.pending.size > 0;
    let y = 685;
    const actionButton = (id, label, fn, primary = false, disabled = false) => {
      this.button(id, label, 1210, y, 345, 46, fn, primary, disabled || busy);
      y += 58;
    };
    if (find("game.takeSouls")) {
      actionButton("take", "Tomar almas   +2 ◇", () =>
        this.dispatch.send("game.takeSouls", {
          opportunityId: find("game.takeSouls").opportunityId,
        }),
      );
      actionButton(
        "sin",
        "Pecar  →",
        () => {
          this.modal = { kind: "sins" };
        },
        true,
      );
      actionButton(
        "conspire",
        "Conspirar   1 ◇",
        () =>
          this.dispatch.send("game.conspire", {
            opportunityId: find("game.conspire").opportunityId,
          }),
        false,
        !find("game.conspire"),
      );
      if (find("game.forceRandomDiscard")) {
        this.button(
          "discard",
          "Forzar descarte · 8 ◇",
          1240,
          623,
          286,
          36,
          () => {
            this.modal = {
              kind: "targets",
              action: find("game.forceRandomDiscard"),
            };
          },
          false,
          busy,
        );
      }
    } else if (find("game.challenge")) {
      actionButton(
        "challenge",
        "Desafiar la declaración",
        () =>
          this.dispatch.send("game.challenge", {
            interactionId: find("game.challenge").interactionId,
          }),
        true,
      );
      actionButton("passChallenge", "Dejar pasar", () =>
        this.dispatch.send("game.passChallenge", {
          interactionId: find("game.passChallenge").interactionId,
        }),
      );
      this.wrap(
        "Si te equivocas, revelarás uno de tus pecados.",
        1220,
        y + 18,
        315,
        12,
        P.muted,
      );
    } else if (find("game.payCounter")) {
      actionButton(
        "counter",
        `Bloquear   ${pub.interaction.cost} ◇`,
        () =>
          this.dispatch.send("game.payCounter", {
            interactionId: find("game.payCounter").interactionId,
          }),
        true,
      );
      actionButton("passCounter", "No intervenir", () =>
        this.dispatch.send("game.passCounter", {
          interactionId: find("game.passCounter").interactionId,
        }),
      );
    } else if (self.prompt && !self.prompt.submitted) {
      const p = self.prompt;
      if (p.kind === "selectPlayer") {
        actionButton(
          "targets",
          "Elegir jugador →",
          () => {
            this.modal = { kind: "targets", prompt: p };
          },
          true,
        );
      } else if (p.kind === "selectDirection") {
        actionButton("left", "← Pasar a la izquierda", () =>
          this.answer({ kind: p.kind, direction: "left" }),
        );
        actionButton(
          "right",
          "Pasar a la derecha →",
          () => this.answer({ kind: p.kind, direction: "right" }),
          true,
        );
      } else if (p.kind === "selectPayment") {
        actionButton(
          "pay",
          "Pagar 3 almas",
          () => this.answer({ kind: p.kind, choice: "pay" }),
          true,
        );
        actionButton("lose", "Revelar un pecado al azar", () =>
          this.answer({ kind: p.kind, choice: "discard" }),
        );
      } else {
        const count = p.count ?? 1;
        actionButton(
          "confirm",
          `Confirmar ${this.selected.length} / ${count}`,
          () =>
            this.answer(
              p.kind === "selectCards"
                ? { kind: p.kind, handCardRefs: this.selected }
                : { kind: p.kind, handCardRef: this.selected[0] },
            ),
          true,
          this.selected.length !== count,
        );
        this.wrap(
          p.ordered
            ? "La primera carta quedará encima de la segunda en el fondo del mazo."
            : "Toca una carta de tu mano y confirma tu elección.",
          1220,
          y + 18,
          315,
          12,
          P.muted,
        );
      }
    } else if (pub.room.status !== "finished") {
      this.text(
        busy ? "Enviando tu decisión…" : "El silencio también es una jugada.",
        1375,
        745,
        16,
        P.muted,
        "center",
        true,
      );
    }
    if (pub.room.status === "finished") this.results(pub, players);
    if (this.modal) this.drawModal();
    this.accessible();
  }
  selectCard(ref) {
    if (this.selected.includes(ref))
      this.selected = this.selected.filter((r) => r !== ref);
    else {
      const count = this.store.view.self.prompt.count ?? 1;
      if (count === 1) this.selected = [ref];
      else if (this.selected.length < count) this.selected.push(ref);
    }
  }
  answer(answer) {
    this.dispatch.send("game.answerPrompt", {
      promptId: this.store.view.self.prompt.promptId,
      answer,
    });
    this.modal = null;
  }
  shade() {
    this.ctx.fillStyle = "#0b0912df";
    this.ctx.fillRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    this.regions = [];
  }
  drawModal() {
    const modal = this.modal,
      v = this.store.view;
    this.shade();
    const wide = modal.kind === "sins";
    this.rect(
      wide ? 390 : 510,
      wide ? 115 : 245,
      wide ? 820 : 580,
      wide ? 657 : 395,
      "#241e2c",
      "#766043",
      12,
    );
    this.button(
      "close-modal",
      "×",
      wide ? 1150 : 1030,
      wide ? 130 : 260,
      40,
      35,
      () => {
        this.modal = null;
      },
    );
    if (modal.kind === "sins") {
      this.text("LA VERDAD ES OPCIONAL", 800, 151, 10, P.gold, "center");
      this.text("Declara un pecado.", 800, 192, 34, P.ink, "center", true);
      this.text(
        "No necesitas tenerlo. Solo debes poder pagar su coste.",
        800,
        230,
        14,
        P.muted,
        "center",
      );
      const action = v.self.legalActions.find(
        (a) => a.type === "game.declareSin",
      );
      Object.entries(sins).forEach(([sin, s], i) => {
        const w = 130,
          x = 430 + (i % 4) * 187 + (166 - w) / 2,
          y = 269 + Math.floor(i / 4) * 208;
        const bounds = this.card(sin, x, y, w, { small: true });
        const enabled = action.allowedSins.includes(sin);
        if (!enabled) {
          this.ctx.fillStyle = "#16131bc9";
          this.ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
        }
        this.regions.push({
          id: "declare:" + sin,
          label: `Declarar ${s.name} por ${s.cost} almas`,
          ...bounds,
          fn: () => {
            if (enabled) this.modal = { kind: "confirmSin", sin, action };
          },
        });
      });
      this.text(
        "Haz clic en un pecado para leer su efecto y confirmar.",
        800,
        741,
        12,
        P.muted,
        "center",
      );
    } else if (modal.kind === "info" || modal.kind === "confirmSin") {
      const s = sins[modal.sin];
      this.text(s.symbol, 800, 306, 52, s.color, "center", true);
      this.text(s.name, 800, 369, 39, s.color, "center", true);
      this.wrap(s.description, 558, 423, 480, 17, P.ink, 27);
      if (modal.kind === "confirmSin")
        this.button(
          "confirmSin",
          `Declarar ${s.name} · ${s.cost} almas`,
          575,
          556,
          450,
          52,
          () => {
            this.dispatch.send("game.declareSin", {
              opportunityId: modal.action.opportunityId,
              sin: modal.sin,
            });
            this.modal = null;
          },
          true,
        );
      else
        this.button("infoDone", "Entendido", 635, 556, 330, 48, () => {
          this.modal = null;
        });
    } else if (modal.kind === "targets") {
      this.text("Elige a tu objetivo.", 800, 288, 31, P.ink, "center", true);
      const ids =
        modal.prompt?.eligiblePlayerIds ?? modal.action.eligiblePlayerIds;
      ids.forEach((id, i) => {
        const p = v.public.players.find((p) => p.playerId === id);
        this.button(
          "target:" + id,
          `${p.displayName}  ·  ${p.souls} ◇`,
          565,
          329 + i * 53,
          470,
          43,
          () => {
            if (modal.prompt)
              this.answer({ kind: "selectPlayer", playerId: id });
            else {
              this.dispatch.send("game.forceRandomDiscard", {
                opportunityId: modal.action.opportunityId,
                targetPlayerId: id,
              });
              this.modal = null;
            }
          },
          false,
        );
      });
    }
  }
  results(pub, players) {
    this.shade();
    this.rect(475, 220, 650, 470, "#251f2b", "#9d8256", 12);
    const result = pub.result,
      winner = players.find((p) => p.playerId === result.winnerPlayerId);
    this.text(winner ? "♛" : "◇", 800, 291, 58, P.gold, "center", true);
    this.text(
      result.endReason === "draw"
        ? "Nadie queda en pie."
        : result.endReason === "abandoned"
          ? "La mesa quedó en silencio."
          : `${winner?.displayName} gana.`,
      800,
      379,
      39,
      P.ink,
      "center",
      true,
    );
    this.text(
      result.endReason === "orgullo"
        ? "El orgullo ha sido su salvación."
        : result.endReason === "last_survivor"
          ? "La última alma en pie."
          : result.endReason === "abandoned"
            ? "Todos los humanos se desconectaron."
            : "Todos revelaron demasiados pecados.",
      800,
      431,
      17,
      P.muted,
      "center",
    );
    this.text("EL PACTO HA TERMINADO", 800, 482, 11, P.gold, "center");
    this.button(
      "return",
      "Volver al inicio →",
      605,
      549,
      390,
      54,
      () => this.dispatch.send("room.leave"),
      true,
    );
    const seconds = Math.max(
      0,
      Math.ceil(
        (Date.parse(pub.room.memberFacingExpiresAt) - this.store.now()) / 1000,
      ),
    );
    this.text(
      `Esta sala se cerrará en ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`,
      800,
      634,
      12,
      P.muted,
      "center",
    );
  }
  update(mouse, pressed) {
    const region = [...this.regions]
      .reverse()
      .find(
        (r) =>
          mouse.x >= r.x &&
          mouse.x <= r.x + r.w &&
          mouse.y >= r.y &&
          mouse.y <= r.y + r.h,
      );
    this.hover = region?.id ?? null;
    document.getElementById("canvas").style.cursor = region
      ? "pointer"
      : "default";
    if (pressed && !document.getElementById("rules").open) region?.fn();
  }
  accessible() {
    const signature =
      this.store.version +
      ":" +
      this.regions.map((r) => r.id + ":" + r.label).join("|");
    if (signature === this.signature) return;
    this.signature = signature;
    const target = document.getElementById("game-controls");
    target.replaceChildren();
    for (const r of this.regions) {
      const b = document.createElement("button");
      b.textContent = r.label;
      b.setAttribute("aria-label", r.label);
      b.style.left = (r.x / DESIGN_WIDTH) * 100 + "%";
      b.style.top = (r.y / DESIGN_HEIGHT) * 100 + "%";
      b.style.width = (r.w / DESIGN_WIDTH) * 100 + "%";
      b.style.height = (r.h / DESIGN_HEIGHT) * 100 + "%";
      b.onclick = () => r.fn();
      target.append(b);
    }
  }
}
