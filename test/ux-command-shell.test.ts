import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { fixture } from "./helpers.js";

const installedChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath = process.env.UX_BROWSER_PATH ??
  (existsSync(installedChrome) ? installedChrome : chromium.executablePath());

test("browser preserves home focus/caret and lobby drafts through live snapshots", {
  skip: !existsSync(executablePath) && "Set UX_BROWSER_PATH or install the Playwright browser to run browser checks",
}, async (t) => {
  const server = spawn(process.execPath, ["tools/ux/serve.mjs"], {
    cwd: new URL("..", import.meta.url), env: { ...process.env, UX_PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => server.kill());
  const origin = await new Promise<string>((resolve, reject) => {
    server.stdout.on("data", (chunk) => {
      const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) resolve(match[0]);
    });
    server.on("error", reject);
  });
  const browser = await chromium.launch({ headless: true, executablePath });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route("**/shell.html", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html lang="es"><body><main id="shell"></main><dialog id="rules"><div id="rules-content"></div><form method="dialog"><button>Cerrar</button></form></dialog></body></html>` }));
  await page.goto(origin + "/tools/ux/shell.html");
  await page.evaluate(async () => {
    const { HomeScene } = await import("/games/insidia/scenes/home-scene.js");
    const { LobbyScene } = await import("/games/insidia/scenes/lobby-scene.js");
    const state = { connected: true, pending: new Map(), rooms: [], version: 0, now: Date.now, view: null };
    const home = new HomeScene(state, { send() { return true; } });
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
  const f = fixture(), active = f.view();
  f.room.status = "lobby";
  const lobby = f.view();
  await page.evaluate((view) => {
    const { state, home, LobbyScene } = (window as any).ux;
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
    const startedModal = dialog.open && dialog.getAttribute("aria-modal") === "true";
    state.view = view;
    const suspended = home.syncRules();
    const closed = !dialog.open;
    home.showRules();
    return { startedModal, suspended, closed, drawer: dialog.open && dialog.dataset.mode === "drawer", ariaModal: dialog.getAttribute("aria-modal") };
  }, active);
  assert.deepEqual(modal, { startedModal: true, suspended: true, closed: true, drawer: true, ariaModal: "false" });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#rules").evaluate((dialog: HTMLDialogElement) => dialog.open), false);
});
