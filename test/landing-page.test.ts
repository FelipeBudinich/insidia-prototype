import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";
import { fixture } from "./helpers.js";

const installedChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = process.env.UX_BROWSER_PATH ??
  (existsSync(installedChrome) ? installedChrome : chromium.executablePath());
const publicId = "00000000-0000-4000-8000-000000000001";
const privateId = "00000000-0000-4000-8000-000000000002";
const otherId = "00000000-0000-4000-8000-000000000003";
const room = (roomId = publicId, visibility = "public", overrides = {}) => ({
  roomId, visibility, status: "lobby", hostDisplayName: "María Fernanda",
  occupiedHumanSeats: 1, configuredHumanSeats: 3, botCount: 2,
  connectedHumanCount: 1, ...overrides,
});

async function snapshot(page: Page, rooms: ReturnType<typeof room>[]) {
  await page.evaluate((rooms) => {
    const { state, home } = (window as any).ux;
    state.apply({ kind: "roomListSnapshot", rooms });
    home.render();
  }, rooms);
}

test("landing directory and dialogs preserve live state and existing lobby/rules behavior", {
  skip: !existsSync(executablePath) && "Set UX_BROWSER_PATH or install the Playwright browser to run browser checks",
}, async (t) => {
  const publicRoot = fileURLToPath(new URL("../public", import.meta.url));
  const contentTypes: Record<string, string> = { ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp" };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url!, "http://127.0.0.1").pathname;
      const file = resolve(publicRoot, decodeURIComponent(pathname).slice(1));
      if (!file.startsWith(publicRoot + sep)) { response.writeHead(404).end(); return; }
      const content = await readFile(file);
      response.writeHead(200, { "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream" }).end(content);
    } catch { response.writeHead(404).end(); }
  });
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const browser = await chromium.launch({ headless: true, executablePath });
  t.after(() => browser.close());
  const createPage = async (rooms: ReturnType<typeof room>[] = [], savedName = "") => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route("**/shell.html", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/games/insidia/style.css"></head><body><main id="shell"></main><div id="connection"></div><div id="toast"></div><dialog id="table-dialog" aria-labelledby="table-dialog-title"><div id="table-dialog-content"></div></dialog><dialog id="rules"><div id="rules-content"></div><form method="dialog"><button>Cerrar</button></form></dialog></body></html>` }));
    await page.goto(origin + "/shell.html");
    await page.evaluate(async ({ rooms, savedName }) => {
      localStorage.setItem("insidia.name", savedName);
      const { HomeScene } = await import("/games/insidia/scenes/home-scene.js");
      const { LobbyScene } = await import("/games/insidia/scenes/lobby-scene.js");
      const { ClientStore } = await import("/games/insidia/state/client-store.js");
      const { Dispatcher } = await import("/games/insidia/commands/command-dispatcher.js");
      const state = new ClientStore();
      state.connected = true;
      state.apply({ kind: "roomListSnapshot", rooms });
      const sent: unknown[] = [];
      const dispatch = new Dispatcher(state, { send(command) { sent.push(command); return true; } });
      const home = new HomeScene(state, dispatch);
      Object.assign(window, { ux: { state, home, dispatch, sent, LobbyScene } });
      home.render();
    }, { rooms, savedName });
    return page;
  };

  await t.test("directory groups available tables, keeps empty sections and updates live", async () => {
    const page = await createPage();
    try {
      assert.equal(await page.getByRole("heading", { name: /^Mesas públicas/ }).count(), 1);
      assert.equal(await page.getByRole("heading", { name: /^Mesas privadas/ }).count(), 1);
      assert.match(await page.locator("#public-tables").innerText(), /No hay/i);
      assert.match(await page.locator("#private-tables").innerText(), /No hay/i);
      assert.equal(await page.locator("#display-name, [data-tab], [data-browse]").count(), 0);
      assert.equal(await page.locator("[data-create]").count(), 1);
      assert.equal(await page.locator("[data-rules]").count(), 1);
      await snapshot(page, [
        room(privateId, "private", { hostDisplayName: "Anfitrión privado" }),
        room(publicId, "public", { hostDisplayName: "Anfitrión público" }),
        room(otherId, "public", { hostDisplayName: "<img onerror=alert(1)>" }),
        room("00000000-0000-4000-8000-000000000004", "public", { occupiedHumanSeats: 3 }),
        room("00000000-0000-4000-8000-000000000005", "private", { status: "active" }),
      ]);
      assert.deepEqual(await page.locator("[data-join]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-join"))), [publicId, otherId, privateId]);
      assert.match(await page.locator(`[data-join="${publicId}"]`).innerText(), /Anfitrión público/);
      assert.match(await page.locator(`[data-join="${publicId}"]`).innerText(), /1\s*\/\s*3.*humanos.*2.*bots/s);
      assert.equal(await page.locator("#private-tables .table-lock[aria-label='Con código']").count(), 1);
      assert.match(await page.locator(`[data-join="${otherId}"]`).innerText(), /<img onerror=alert\(1\)>/);
      assert.equal(await page.locator(".table-row img").count(), 0);
      await snapshot(page, [room(privateId, "public")]);
      assert.equal(await page.locator("#public-tables [data-join]").count(), 1);
      assert.equal(await page.locator("#private-tables [data-join]").count(), 0);
    } finally { await page.close(); }
  });

  await t.test("create defaults public, validates names/totals, and retains drafts through snapshots", async () => {
    const page = await createPage();
    try {
      await page.locator("[data-create]").click();
      assert.equal(await page.locator("#table-dialog").evaluate((dialog) => dialog.matches(":modal")), true);
      assert.equal(await page.locator("#display-name").evaluate((input) => input === document.activeElement), true);
      assert.equal(await page.locator("#visibility").inputValue(), "public");
      assert.equal(await page.locator("#humans").inputValue(), "0");
      assert.equal(await page.locator("#bots").inputValue(), "2");
      assert.equal(await page.locator("#total").innerText(), "3 jugadores");
      await page.locator("#create-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
      assert.equal(await page.evaluate(() => (window as any).ux.sent.length), 0);
      await page.locator("#display-name").fill("   ");
      await page.locator("#create-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
      assert.equal(await page.evaluate(() => (window as any).ux.sent.length), 0);
      await page.locator("#display-name").fill("María Fernanda");
      await page.locator("#visibility").selectOption("private");
      await page.locator("#humans").selectOption("1");
      await page.locator("#display-name").focus();
      await page.locator("#display-name").evaluate((input: HTMLInputElement) => {
        input.setSelectionRange(3, 8); (window as any).originalInput = input;
      });
      await snapshot(page, [room()]);
      await snapshot(page, [room(privateId, "private")]);
      assert.deepEqual(await page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>("#display-name")!;
        return { same: input === (window as any).originalInput, focused: document.activeElement === input,
          value: input.value, start: input.selectionStart, end: input.selectionEnd };
      }), { same: true, focused: true, value: "María Fernanda", start: 3, end: 8 });
      assert.equal(await page.locator("#visibility").inputValue(), "private");
      assert.equal(await page.locator("#humans").inputValue(), "1");
      assert.equal(await page.locator("#total").innerText(), "4 jugadores");
      assert.equal(await page.evaluate(() => localStorage.getItem("insidia.name")), "María Fernanda");
      for (const [humans, bots] of [["0", "0"], ["5", "5"]]) {
        await page.locator("#humans").selectOption(humans);
        await page.locator("#bots").selectOption(bots);
        await page.locator("#create-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
        assert.equal(await page.evaluate(() => (window as any).ux.sent.length), 0);
      }
      await page.locator("#humans").selectOption("1");
      await page.locator("#bots").selectOption("2");
      await page.locator('#create-form button[type="submit"]').click();
      const command = await page.evaluate(() => (window as any).ux.sent[0]);
      assert.equal(command.type, "room.create");
      assert.deepEqual(command.payload, { visibility: "private", displayName: "María Fernanda", additionalHumanPlayers: 1, botPlayers: 2 });
      assert.equal("roomId" in command, false);
    } finally { await page.close(); }
  });

  await t.test("join dialogs dispatch selected targets and preserve six-digit private codes", async () => {
    const page = await createPage([room(), room(privateId, "private")], "Nombre guardado");
    try {
      await page.locator(`[data-join="${publicId}"]`).click();
      assert.equal(await page.locator("#display-name").inputValue(), "Nombre guardado");
      assert.equal(await page.locator("#private-code").count(), 0);
      assert.equal(await page.evaluate(() => (window as any).ux.sent.length), 0);
      await page.locator("#display-name").fill("  Cómplice  ");
      await page.locator('#join-form button[type="submit"]').click();
      assert.deepEqual(await page.evaluate(() => {
        const { sent, state } = (window as any).ux, command = sent[0];
        return { type: command.type, payload: command.payload, roomId: command.roomId,
          origin: state.pending.get(command.commandId).origin };
      }), { type: "room.joinPublic", payload: { displayName: "Cómplice" }, roomId: publicId, origin: `room.joinPublic:${publicId}` });
      await page.evaluate(() => {
        const { home, state } = (window as any).ux;
        state.pending.clear(); state.commandFeedback = null;
        home.closeTableDialog(); home.render();
      });
      await page.locator(`[data-join="${privateId}"]`).click();
      await page.locator("#private-code").fill("00123");
      await page.locator("#join-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
      assert.equal(await page.evaluate(() => (window as any).ux.sent.length), 1);
      await page.locator("#private-code").fill("001234");
      await page.locator("#private-code").focus();
      await snapshot(page, [room(otherId), room(privateId, "private")]);
      assert.equal(await page.locator("#private-code").inputValue(), "001234");
      assert.equal(await page.locator("#private-code").evaluate((input) => input === document.activeElement), true);
      await page.locator('#join-form button[type="submit"]').click();
      assert.deepEqual(await page.evaluate(() => {
        const { sent, state } = (window as any).ux, command = sent[1];
        return { type: command.type, payload: command.payload, roomId: command.roomId,
          origin: state.pending.get(command.commandId).origin };
      }), { type: "room.joinPrivate", payload: { displayName: "Cómplice", code: "001234" }, roomId: privateId, origin: `room.joinPrivate:${privateId}` });
    } finally { await page.close(); }
  });

  await t.test("pending/rejected feedback stays in the dialog and prevents duplicate submissions", async () => {
    const page = await createPage([room(privateId, "private")], "Cómplice");
    try {
      await page.locator(`[data-join="${privateId}"]`).click();
      await page.locator("#private-code").fill("001234");
      await page.locator('#join-form button[type="submit"]').click();
      assert.equal(await page.locator('#join-form button[type="submit"]').isDisabled(), true);
      assert.match(await page.locator("#table-dialog").innerText(), /Enviando/);
      await page.locator("#join-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
      assert.equal(await page.evaluate(() => (window as any).ux.sent.length), 1);
      await page.evaluate(() => {
        const { state, home, sent } = (window as any).ux;
        state.apply({ kind: "commandResult", commandId: sent[0].commandId, status: "rejected", code: "ROOM_NOT_FOUND" });
        home.render();
      });
      assert.equal(await page.locator("#table-dialog").evaluate((dialog: HTMLDialogElement) => dialog.open), true);
      assert.equal(await page.locator("#private-code").inputValue(), "001234");
      assert.equal(await page.locator('#join-form button[type="submit"]').isEnabled(), true);
      assert.ok((await page.locator("#table-dialog .command-feedback").innerText()).trim());
      assert.doesNotMatch(await page.locator("#table-dialog .command-feedback").innerText(), /Enviando/);
      await page.locator("#private-code").fill("006789");
      await page.locator('#join-form button[type="submit"]').click();
      assert.equal(await page.evaluate(() => (window as any).ux.sent.length), 2);
    } finally { await page.close(); }
  });

  await t.test("unavailable selected tables retain the join draft and block submission", async () => {
    const page = await createPage([room(privateId, "private")], "Cómplice");
    try {
      await page.locator(`[data-join="${privateId}"]`).click();
      await page.locator("#private-code").fill("001234");
      for (const rooms of [[], [room(privateId, "private", { occupiedHumanSeats: 3 })], [room(privateId, "public")], [room(privateId, "private", { status: "active" })]]) {
        await snapshot(page, rooms);
        assert.equal(await page.locator("#table-dialog").evaluate((dialog: HTMLDialogElement) => dialog.open), true);
        assert.equal(await page.locator("#display-name").inputValue(), "Cómplice");
        assert.equal(await page.locator("#private-code").inputValue(), "001234");
        assert.equal(await page.locator('#join-form button[type="submit"]').isDisabled(), true);
        assert.match(await page.locator("#table-dialog").innerText(), /no.*disponible/i);
        await page.locator("#join-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
        assert.equal(await page.evaluate(() => (window as any).ux.sent.length), 0);
      }
      await snapshot(page, [room(privateId, "private")]);
      assert.equal(await page.locator('#join-form button[type="submit"]').isEnabled(), true);
    } finally { await page.close(); }
  });

  await t.test("modal keyboard focus, close controls, and fresh public defaults", async () => {
    const page = await createPage([room()], "Cómplice");
    try {
      await page.locator("[data-create]").click();
      assert.equal(await page.locator("#table-dialog").evaluate((dialog) => {
        const title = dialog.getAttribute("aria-labelledby");
        return Boolean(title && document.getElementById(title)?.textContent?.trim());
      }), true);
      assert.equal(await page.locator("#table-dialog").evaluate((dialog) => [...dialog.querySelectorAll("input, select")].every((input: HTMLInputElement) => input.labels?.length)), true);
      for (let i = 0; i < 9; i++) {
        await page.keyboard.press("Tab");
        assert.equal(await page.locator("#table-dialog").evaluate((dialog) => dialog.contains(document.activeElement)), true, `Tab ${i + 1} must keep focus in the modal`);
      }
      await page.locator("#table-dialog [data-close-table]").focus();
      await page.keyboard.press("Shift+Tab");
      assert.equal(await page.locator('#create-form button[type="submit"]').evaluate((button) => button === document.activeElement), true);
      await page.locator("#visibility").selectOption("private");
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#table-dialog").evaluate((dialog: HTMLDialogElement) => dialog.open), false);
      assert.equal(await page.locator("[data-create]").evaluate((button) => button === document.activeElement), true);
      await page.locator("[data-create]").click();
      assert.equal(await page.locator("#visibility").inputValue(), "public");
      await page.locator("#table-dialog [data-close-table]").click();
      assert.equal(await page.locator("[data-create]").evaluate((button) => button === document.activeElement), true);
      await page.locator(`[data-join="${publicId}"]`).click();
      await page.keyboard.press("Escape");
      assert.equal(await page.locator(`[data-join="${publicId}"]`).evaluate((button) => button === document.activeElement), true);
    } finally { await page.close(); }
  });

  await t.test("long directories scroll inside the panel at desktop and mobile widths", async () => {
    const rooms = Array.from({ length: 30 }, (_, index) => room(
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      index % 2 ? "private" : "public", { hostDisplayName: "UnaAnfitrionaConNombreMuyLargo".repeat(3) },
    ));
    const page = await createPage(rooms);
    try {
      for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(viewport);
        const layout = await page.evaluate(() => {
          const directory = document.querySelector<HTMLElement>(".table-directory")!;
          const button = document.querySelector<HTMLElement>("[data-create]")!;
          const listBounds = directory.getBoundingClientRect(), buttonBounds = button.getBoundingClientRect();
          const before = buttonBounds.top;
          directory.scrollTop = directory.scrollHeight;
          return {
            scrollable: directory.scrollHeight > directory.clientHeight, overflow: getComputedStyle(directory).overflowY,
            buttonOutsideList: !directory.contains(button), buttonBelowList: buttonBounds.top >= listBounds.bottom - 1,
            buttonStable: button.getBoundingClientRect().top === before, fitsWidth: document.documentElement.scrollWidth <= innerWidth,
          };
        });
        assert.deepEqual(layout, { scrollable: true, overflow: "auto", buttonOutsideList: true, buttonBelowList: true, buttonStable: true, fitsWidth: true });
        await page.locator("[data-create]").click();
        assert.equal(await page.locator("#table-dialog").evaluate((dialog) => {
          const bounds = dialog.getBoundingClientRect();
          return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight;
        }), true);
        await page.keyboard.press("Escape");
      }
    } finally { await page.close(); }
  });

  await t.test("membership dismisses table dialogs while lobby drafts and original rules modal still work", async () => {
    const page = await createPage([], "Cómplice");
    try {
      const f = fixture(), active = f.view();
      f.room.status = "lobby";
      const lobby = f.view();
      await page.locator("[data-create]").click();
      await page.locator('#create-form button[type="submit"]').click();
      await page.evaluate(async (view) => {
        const { state, home, LobbyScene } = (window as any).ux;
        const { InsidiaGame } = await import("/games/insidia/game/insidia-game.js");
        state.pending.clear(); state.view = view;
        const scene = new LobbyScene(state, { send() { return true; } }, home);
        (window as any).ux.lobby = scene;
        InsidiaGame.prototype.renderShell.call({ store: state, home, lobby: scene });
      }, lobby);
      assert.equal(await page.locator("#table-dialog").evaluate((dialog: HTMLDialogElement) => dialog.open), false);
      await page.locator("#lobby-bots").selectOption("1");
      await page.locator("#lobby-bots").focus();
      const draft = await page.evaluate(() => {
        const { state, lobby } = (window as any).ux, before = document.querySelector("#lobby-bots");
        state.view = structuredClone(state.view); state.view.public.players[1].connected = false;
        lobby.render(); lobby.render();
        const after = document.querySelector<HTMLSelectElement>("#lobby-bots")!;
        return { same: before === after, focused: document.activeElement === after, value: after.value };
      });
      assert.deepEqual(draft, { same: true, focused: true, value: "1" });
      const modal = await page.evaluate((view) => {
        const { state, home } = (window as any).ux;
        home.showRules();
        const dialog = document.querySelector<HTMLDialogElement>("#rules")!;
        const startedModal = dialog.matches(":modal");
        state.view = view;
        const stayedOpen = dialog.open;
        dialog.close(); home.showRules();
        return {
          startedModal, stayedOpen, matchModal: dialog.matches(":modal"),
          drawer: dialog.classList.contains("rules-drawer"), mode: dialog.dataset.mode,
          clock: Boolean(document.querySelector("#rules-clock")),
          ariaModal: dialog.getAttribute("aria-modal"), labelledBy: dialog.getAttribute("aria-labelledby"),
          synchronizesMatchRules: typeof home.syncRules === "function",
        };
      }, active);
      assert.deepEqual(modal, {
        startedModal: true, stayedOpen: true, matchModal: true, drawer: false, mode: undefined,
        clock: false, ariaModal: null, labelledBy: null, synchronizesMatchRules: false,
      });
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#rules").evaluate((dialog: HTMLDialogElement) => dialog.open), false);
      assert.equal(await page.evaluate(() => {
        const { state, home } = (window as any).ux;
        state.view.public.room.status = "finished"; home.showRules();
        return document.querySelector("#rules")!.matches(":modal");
      }), true);
    } finally { await page.close(); }
  });
});
