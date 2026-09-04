import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { fixture } from "./helpers.js";

const installedChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = process.env.UX_BROWSER_PATH ??
  (existsSync(installedChrome) ? installedChrome : chromium.executablePath());

test("landing retains live form drafts and room feedback while match rules use the original modal", {
  skip: !existsSync(executablePath) && "Set UX_BROWSER_PATH or install the Playwright browser to run browser checks",
}, async (t) => {
  const publicRoot = fileURLToPath(new URL("../public", import.meta.url));
  const contentTypes: Record<string, string> = {
    ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp",
  };
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url!, "http://127.0.0.1").pathname;
      const file = resolve(publicRoot, decodeURIComponent(pathname).slice(1));
      if (!file.startsWith(publicRoot + sep)) {
        response.writeHead(404).end();
        return;
      }
      const content = await readFile(file);
      response.writeHead(200, { "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream" }).end(content);
    } catch {
      response.writeHead(404).end();
    }
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
  const page = await browser.newPage();
  await page.route("**/shell.html", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="es"><body><main id="shell"></main><dialog id="rules"><div id="rules-content"></div><form method="dialog"><button>Cerrar</button></form></dialog></body></html>` }));
  await page.goto(origin + "/shell.html");
  await page.evaluate(async () => {
    const { HomeScene } = await import("/games/insidia/scenes/home-scene.js");
    const { LobbyScene } = await import("/games/insidia/scenes/lobby-scene.js");
    const state = { connected: true, pending: new Map(), rooms: [], version: 0, now: Date.now, view: null };
    const home = new HomeScene(state, {
      send(type, payload, roomId, origin) {
        state.pending.set("pending-command", { command: { type, payload, roomId }, origin });
        return true;
      },
    });
    Object.assign(window, { ux: { state, home, LobbyScene } });
    home.render();
  });
  await page.locator("#display-name").fill("María Fernanda");
  await page.locator("#display-name").evaluate((input: HTMLInputElement) => { input.setSelectionRange(3, 8); (window as any).originalInput = input; });
  const preserved = await page.evaluate(() => {
    const { state, home } = (window as any).ux;
    state.rooms = [{ roomId: "directory-update" }]; state.version++;
    home.render(); home.render();
    const input = document.querySelector<HTMLInputElement>("#display-name")!;
    return { same: input === (window as any).originalInput, focused: document.activeElement === input, value: input.value, start: input.selectionStart, end: input.selectionEnd };
  });
  assert.deepEqual(preserved, { same: true, focused: true, value: "María Fernanda", start: 3, end: 8 });
  await page.evaluate(() => {
    const { state, home } = (window as any).ux;
    state.rooms = ["first-room", "second-room"].map((roomId) => ({
      roomId, hostDisplayName: roomId, occupiedHumanSeats: 1,
      configuredHumanSeats: 3, botCount: 0, connectedHumanCount: 1,
    }));
    home.screen = "browser";
    home.render();
  });
  await page.locator('[data-join="second-room"]').click();
  const feedback = await page.evaluate(() => {
    const { state, home } = (window as any).ux;
    home.render();
    return {
      origin: state.pending.get("pending-command").origin,
      first: document.querySelector('[data-join="first-room"]')!.textContent,
      second: document.querySelector('[data-join="second-room"]')!.textContent,
    };
  });
  assert.deepEqual(feedback, { origin: "room.joinPublic:second-room", first: "Tomar asiento →", second: "Enviando…" });
  const f = fixture(), active = f.view();
  f.room.status = "lobby";
  const lobby = f.view();
  await page.evaluate((view) => {
    const { state, home, LobbyScene } = (window as any).ux;
    state.pending.clear();
    state.view = view;
    const scene = new LobbyScene(state, { send() { return true; } }, home);
    (window as any).ux.lobby = scene; scene.render();
  }, lobby);
  await page.locator("#lobby-bots").selectOption("1");
  await page.locator("#lobby-bots").focus();
  const draft = await page.evaluate(() => {
    const { state, lobby } = (window as any).ux;
    const before = document.querySelector("#lobby-bots");
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
    dialog.close();
    home.showRules();
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
  const finishedModal = await page.evaluate(() => {
    const { state, home } = (window as any).ux;
    state.view.public.room.status = "finished";
    home.showRules();
    return document.querySelector("#rules")!.matches(":modal");
  });
  assert.equal(finishedModal, true);
});
