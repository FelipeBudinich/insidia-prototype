import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { BoardRenderer } from "../public/games/insidia/ui/board-renderer.js";
import { sins } from "../public/games/insidia/ui/strings.js";

type Bounds = { x: number; y: number; w: number; h: number };
type Rectangle = Bounds & { fill?: string };
type DrawnImage = Bounds & { kind: "pecado" | "conspiracy" };

function fixture(t: TestContext, handCount = 2, playerCount = 6) {
  const rectangles: Rectangle[] = [],
    fills: Rectangle[] = [],
    images: DrawnImage[] = [],
    texts: { text: string; x: number; y: number }[] = [],
    sent: { type: string; payload: any }[] = [];
  let path: Rectangle | undefined;
  const ctx = {
    fillStyle: "",
    beginPath() { path = undefined; },
    roundRect(x: number, y: number, w: number, h: number) {
      path = { x, y, w, h };
      rectangles.push(path);
    },
    fill() { if (path) path.fill = this.fillStyle; },
    stroke() {},
    clip() {},
    save() {},
    restore() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    arc() {},
    ellipse() {},
    createRadialGradient() { return { addColorStop() {} }; },
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ x, y, w, h, fill: this.fillStyle });
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y });
    },
    drawImage(
      data: { kind: DrawnImage["kind"] },
      _sourceX: number,
      _sourceY: number,
      _sourceWidth: number,
      _sourceHeight: number,
      x: number,
      y: number,
      w: number,
      h: number,
    ) {
      images.push({ kind: data.kind, x, y, w, h });
    },
    measureText(text: string) { return { width: text.length * 7 }; },
  };
  const controls = {
    children: [] as any[],
    replaceChildren() { this.children = []; },
    append(child: any) { this.children.push(child); },
  };
  const elements = {
    canvas: { style: { cursor: "" } },
    rules: { open: false },
    "game-controls": controls,
  };
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      getElementById(id: keyof typeof elements) { return elements[id]; },
      createElement() { return { style: {}, setAttribute() {} }; },
    },
  });
  t.after(() => {
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else delete (globalThis as any).document;
  });
  const hand = Object.keys(sins).slice(0, handCount).map((sin, i) => ({
    sin,
    handCardRef: `card-${i}`,
  }));
  const players = Array.from({ length: playerCount }, (_, i) => ({
    playerId: `player-${i}`,
    seatIndex: i,
    displayName: `Jugador ${i + 1}`,
    kind: i ? "bot" : "human",
    status: "active",
    connected: true,
    souls: 2,
    handCount: 2,
    faceUpSins: i === 1 ? [{ sin: "RABIA" }] : [],
  }));
  const view: any = {
    public: {
      room: { status: "active", visibility: "private" },
      players,
      board: {
        soulBank: 28,
        sinDeckCount: 20,
        conspiracyDeckCount: 5,
        publicCenter: [],
        revealedConspiracy: { conspiracy: "HEREJIA" },
      },
      turn: { turnNumber: 1, phase: "action", activePlayerId: "player-0" },
      recentEffects: [],
    },
    self: {
      playerId: "player-0",
      hand,
      legalActions: [
        { type: "game.takeSouls", opportunityId: "opportunity" },
        { type: "game.conspire", opportunityId: "opportunity" },
        {
          type: "game.declareSin",
          opportunityId: "opportunity",
          allowedSins: Object.keys(sins).filter((sin) => sins[sin].cost === 0),
        },
      ],
    },
  };
  const store = { view, version: 1, pending: new Set(), now: () => 0 };
  const image = (kind: DrawnImage["kind"], width: number, height: number) => ({
    loaded: true,
    data: { kind },
    width,
    height,
    getSourceRect() { return { x: 0, y: 0, width, height }; },
  });
  const renderer = new BoardRenderer(
    store,
    { send(type: string, payload: any) { sent.push({ type, payload }); } },
    { showRules() {} },
    {
      pecadoBack: image("pecado", 732, 1024),
      conspiracyBack: image("conspiracy", 1024, 732),
    },
  );
  const draw = () => {
    rectangles.length = fills.length = texts.length = images.length = 0;
    renderer.draw(ctx);
  };
  draw();
  return {
    renderer,
    store,
    rectangles,
    fills,
    images,
    texts,
    controls,
    sent,
    draw,
  };
}

function bounds(r: Bounds): Bounds {
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

function ratio(r: Bounds, width: number, height: number) {
  assert(Math.abs(r.w * height - r.h * width) < 1e-9);
}

function assertControlBounds(f: ReturnType<typeof fixture>) {
  assert.equal(f.controls.children.length, f.renderer.regions.length);
  f.renderer.regions.forEach((region: any, i: number) => {
    const button = f.controls.children[i];
    assert.equal(button.style.left, region.x / 16 + "%");
    assert.equal(button.style.top, region.y / 9 + "%");
    assert.equal(button.style.width, region.w / 16 + "%");
    assert.equal(button.style.height, region.h / 9 + "%");
  });
}

test("deck and opponent cards use the supplied backs at their exact ratios", (t) => {
  const f = fixture(t);
  const pecadoBacks = f.images.filter((image) => image.kind === "pecado");
  assert.equal(pecadoBacks.length, 11);
  const sinDeck = pecadoBacks.find((image) => image.w === 100)!;
  assert.deepEqual(bounds(sinDeck), { x: 633, y: 286, w: 100, h: 140 });
  ratio(sinDeck, 5, 7);
  assert.equal(sinDeck.x + sinDeck.w / 2, 683);
  assert.equal(sinDeck.y + sinDeck.h / 2, 356);
  const conspiracyBacks = f.images.filter(
    (image) => image.kind === "conspiracy",
  );
  assert.equal(conspiracyBacks.length, 1);
  const conspiracyDeck = conspiracyBacks[0];
  assert.deepEqual(bounds(conspiracyDeck), { x: 847, y: 306, w: 140, h: 100 });
  ratio(conspiracyDeck, 7, 5);
  assert.equal(conspiracyDeck.x + conspiracyDeck.w / 2, 917);
  assert.equal(conspiracyDeck.y + conspiracyDeck.h / 2, 356);
  assert.deepEqual(f.texts.filter((r) => /^(20 PECADOS|5 CONSPIRACIONES)$/.test(r.text)), [
    { text: "20 PECADOS", x: 683, y: 443 },
    { text: "5 CONSPIRACIONES", x: 917, y: 443 },
  ]);
  const miniCards = pecadoBacks.filter((image) => image.w === 15);
  assert.equal(miniCards.length, 10);
  for (const mini of miniCards) {
    assert.equal(mini.w, 15);
    assert.equal(mini.h, 21);
    ratio(mini, 5, 7);
  }
  assert.deepEqual(bounds(f.rectangles.find((r) => r.fill === "#322437")!),
    { x: 638, y: 474, w: 324, h: 41 });
  const exposedLabel = f.rectangles.find((r) => r.fill === "#37262b")!;
  assert.equal(exposedLabel.w, 80);
  assert.equal(exposedLabel.h, 24);
});

for (const handCount of [2, 3, 4]) {
  test(`${handCount}-card hand is centered, ratio-correct and matches all controls`, (t) => {
    const f = fixture(t, handCount);
    const cards = f.rectangles.filter((r) => r.fill === "#2b2631");
    const regions = f.renderer.regions.filter((r: any) => r.id.startsWith("info:"));
    assert.equal(cards.length, handCount);
    assert.equal(regions.length, handCount);
    cards.forEach((card, i) => {
      assert.equal(card.w, 132);
      assert.equal(card.h, 184.8);
      ratio(card, 5, 7);
      assert.deepEqual(bounds(regions[i]), bounds(card));
      assert(card.x >= 250 && card.x + card.w <= 1210);
      assert(card.y === 690 && card.y + card.h < 900);
      if (i) assert.equal(card.x - cards[i - 1].x - card.w, 19);
    });
    assert.equal((cards[0].x + cards.at(-1)!.x + 132) / 2, 800);
    assertControlBounds(f);
    const first = cards[0];
    f.renderer.update({ x: first.x + 5, y: first.y + first.h + 1 }, true);
    assert.equal(f.renderer.modal, null, "old card bottom must not remain clickable");
    f.renderer.update({ x: first.x + 5, y: first.y + first.h - 1 }, true);
    assert.deepEqual(f.renderer.modal, { kind: "info", sin: "ORGULLO" });
  });
}

test("declaration cards stay centered in their cells with matching disabled masks and controls", (t) => {
  const f = fixture(t);
  f.renderer.modal = { kind: "sins" };
  f.draw();
  const regions = f.renderer.regions.filter((r: any) => r.id.startsWith("declare:"));
  const cards = f.rectangles.filter((r) => r.fill === "#2b2631" && r.w === 130);
  const masks = f.fills.filter((r) => r.fill === "#16131bc9");
  assert.equal(cards.length, 8);
  assert.equal(regions.length, 8);
  assert.equal(masks.length, 2);
  cards.forEach((card, i) => {
    assert.deepEqual(bounds(card), {
      x: 448 + (i % 4) * 187,
      y: 269 + Math.floor(i / 4) * 208,
      w: 130,
      h: 182,
    });
    ratio(card, 5, 7);
    assert.equal(card.x + card.w / 2, 430 + (i % 4) * 187 + 166 / 2);
    assert.deepEqual(bounds(regions[i]), bounds(card));
    if (i < 2) assert.deepEqual(bounds(masks[i]), bounds(card));
  });
  assertControlBounds(f);
  f.renderer.update({ x: cards[2].x - 1, y: cards[2].y + 30 }, true);
  assert.equal(f.renderer.modal.kind, "sins", "old card edge must not remain clickable");
  regions[0].fn();
  assert.equal(f.renderer.modal.kind, "sins", "unaffordable cards cannot be declared");
  f.renderer.update({ x: cards[2].x + 10, y: cards[2].y + 30 }, true);
  assert.equal(f.renderer.modal.kind, "confirmSin");
  assert.equal(f.renderer.modal.sin, "GULA");
  f.draw();
  f.renderer.regions.find((r: any) => r.id === "confirmSin").fn();
  assert.deepEqual(f.sent, [{
    type: "game.declareSin",
    payload: { opportunityId: "opportunity", sin: "GULA" },
  }]);
});

test("expanded hand supports ordered selection and confirmation through matching controls", (t) => {
  const f = fixture(t, 4);
  f.store.view.self.legalActions = [];
  f.store.view.self.prompt = {
    promptId: "prompt",
    purpose: "envidiaBottomOrder",
    kind: "selectCards",
    count: 2,
    ordered: true,
    eligibleHandCardRefs: f.store.view.self.hand.map((card: any) => card.handCardRef),
  };
  f.store.version++;
  f.draw();
  const regions = f.renderer.regions.filter((r: any) => r.id.startsWith("hand:"));
  const cards = f.rectangles.filter((r) => r.fill === "#2b2631");
  regions.forEach((region: Bounds, i: number) => assert.deepEqual(bounds(region), bounds(cards[i])));
  const click = (i: number) => {
    const r = regions[i];
    f.renderer.update({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, true);
    f.draw();
  };
  click(2);
  click(0);
  click(1);
  assert.deepEqual(f.renderer.selected, ["card-2", "card-0"]);
  click(2);
  click(1);
  assert.deepEqual(f.renderer.selected, ["card-0", "card-1"]);
  assert.equal(f.rectangles.filter((r) => r.fill === "#d2b478" && r.w === 27).length, 2);
  assertControlBounds(f);
  const confirmIndex = f.renderer.regions.findIndex((r: any) => r.id === "confirm");
  f.controls.children[confirmIndex].onclick();
  assert.deepEqual(f.sent, [{
    type: "game.answerPrompt",
    payload: {
      promptId: "prompt",
      answer: { kind: "selectCards", handCardRefs: ["card-0", "card-1"] },
    },
  }]);
});
