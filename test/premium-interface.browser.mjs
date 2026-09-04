// Local browser regression suite. Run with INSIDIA_TEST_URL=http://localhost:8789 node test/premium-interface.browser.mjs.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.INSIDIA_TEST_URL ?? 'http://localhost:8789';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
const failures = [];
page.on('pageerror', error => failures.push(String(error)));
await page.route('**/__premium_fixture__', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="es"><head><link rel="stylesheet" href="/games/insidia/style.css"><link rel="stylesheet" href="/games/insidia/premium-interface.css"></head><body><div id="stage" style="display:block;width:844px;height:390px"><div id="game-announcer" class="game-accessible"></div></div><dialog id="rules"></dialog><script>window.ImpactPrefix='/'</script></body></html>` }));
await page.goto(`${base}/__premium_fixture__`);
await page.evaluate(async () => {
  const { PremiumInterface } = await import('/games/insidia/ui/premium-interface.js');
  const { boardLayout } = await import('/games/insidia/ui/board-layout.js');
  const { sins } = await import('/games/insidia/ui/strings.js');
  const players = ['Tú', 'La Sombra de un Nombre', 'El Cuervo', 'La Luna', 'El Eco', 'El Silencio'].map((displayName, index) => ({ playerId: `p${index}`, displayName, seatIndex: index, souls: 4, handCount: 2, faceUpSins: [], status: 'active' }));
  const hand = ['GULA', 'ENVIDIA', 'LUJURIA', 'RABIA'].map((sin, index) => ({ sin, handCardRef: `ref${index}` }));
  const deadline = new Date(Date.now() + 60000).toISOString();
  const fixture = {
    connected: true, pending: new Map(), now: () => Date.now(),
    view: { roomId: 'room', stateVersion: 1, self: { playerId: 'p0', hand, legalActions: [{ type: 'game.takeSouls', opportunityId: 'turn1' }, { type: 'game.conspire', opportunityId: 'turn1' }, { type: 'game.declareSin', opportunityId: 'turn1', allowedSins: Object.keys(sins).filter(s => s !== 'ORGULLO') }], prompt: null },
      public: { room: { status: 'active' }, players, turn: { activePlayerId: 'p0', deadline, turnNumber: 1 }, interaction: null, recentEffects: [], board: { soulBank: 20, sinDeckCount: 18, conspiracyDeckCount: 12, publicCenter: [], revealedConspiracy: null } } },
  };
  window.fixture = fixture;
  window.sent = [];
  window.ui = new PremiumInterface(fixture, { send(type, payload) { window.sent.push({ type, payload }); fixture.pending.set('receipt', {}); return true; } }, {});
  window.paint = () => window.ui.render(boardLayout(innerWidth, innerHeight, fixture.view));
  window.prompt = (id, purpose, kind = 'selectCards', options = {}) => {
    fixture.pending.clear();
    fixture.view.self.prompt = { promptId: id, purpose, kind, deadline, eligibleHandCardRefs: hand.map(c => c.handCardRef), count: kind === 'selectCards' ? 2 : 1, ordered: kind === 'selectCards', ...options };
    fixture.view.self.legalActions = [{ type: 'game.answerPrompt', promptId: id }];
    window.paint();
  };
  window.paint();
});
const control = id => page.locator(`[data-control-id="${id}"]`);
await control('open:declaration').click();
assert.equal(await page.locator('.premium-sin-option').count(), 8);
assert.equal(await control('declare:ORGULLO').isDisabled(), true);
await control('reference:ORGULLO').click();
assert.match(await page.locator('.premium-inspector').textContent(), /9 almas/);
await control('close:inspector').click();
await control('declare:RABIA').click();
assert.equal(await page.locator('.premium-seat-target').count(), 0, 'declaration must not ask for early targets');
await control('confirm:declaration:turn1').click();
assert.deepEqual(await page.evaluate(() => window.sent), [{ type: 'game.declareSin', payload: { opportunityId: 'turn1', sin: 'RABIA' } }]);
await page.evaluate(() => window.prompt('env', 'envidiaBottomOrder'));
await control('hand:ref0').click();
await control('hand:ref1').click();
await control('hand:ref0').focus();
const focusStable = await page.evaluate(() => {
  const before = document.activeElement;
  for (let i = 0; i < 6; i++) { fixture.view = structuredClone(fixture.view); fixture.view.stateVersion++; window.paint(); }
  return before === document.activeElement && before === document.querySelector('[data-control-id="hand:ref0"]');
});
assert.equal(focusStable, true, 'equivalent snapshots must keep focused DOM node');
await control('inspect:ref2').click();
assert.match(await page.locator('.premium-inspector').textContent(), /Lujuria/);
assert.deepEqual(await page.evaluate(() => window.ui.selected), ['ref0', 'ref1']);
await control('close:inspector').click();
await control('order:swap:env').click();
await control('confirm:cards:env').click();
assert.deepEqual((await page.evaluate(() => window.sent)).at(-1).payload.answer.handCardRefs, ['ref1', 'ref0']);
await page.evaluate(() => window.prompt('give', 'lujuriaGiveCard', 'selectCard'));
assert.deepEqual(await page.evaluate(() => window.ui.selected), []);
assert.match(await page.locator('.premium-decision-title').textContent(), /Entregar/);
await page.evaluate(() => window.prompt('return', 'lujuriaReturnCard', 'selectCard'));
assert.match(await page.locator('.premium-decision-title').textContent(), /Devolver/);
await page.evaluate(() => window.prompt('sealed', 'herejiaCards', 'selectHerejiaCard', { submitted: false }));
await control('hand:ref2').click();
await page.evaluate(() => { fixture.view.self.prompt.submitted = true; fixture.view.self.prompt.eligibleHandCardRefs = []; fixture.view.self.legalActions = []; window.paint(); });
assert.equal(await page.locator('[data-control-id="confirm:cards:sealed"]').count(), 0);
assert.match(await page.locator('.premium-decision-title').textContent(), /Tu elección está sellada/);
assert.deepEqual(await page.evaluate(() => window.ui.selected), []);
assert.doesNotMatch(await page.locator('#premium-ui').textContent(), /\d de \d.*(elecci|sellad)/);
await page.evaluate(() => window.prompt('timeout', 'lujuriaGiveCard', 'selectCard'));
await control('hand:ref0').click();
const sentBeforeTimeout = await page.evaluate(() => window.sent.length);
await page.evaluate(() => { fixture.view.self.prompt.deadline = new Date(0).toISOString(); });
await control('confirm:cards:timeout').click();
assert.equal(await page.evaluate(() => window.sent.length), sentBeforeTimeout, 'activation must revalidate deadline before next render');
await page.evaluate(() => { fixture.view.self.prompt.deadline = new Date(Date.now() + 30000).toISOString(); window.paint(); });
await control('inspect:ref0').click();
await page.evaluate(() => { fixture.view.self.hand = fixture.view.self.hand.filter(c => c.handCardRef !== 'ref0'); window.paint(); });
assert.equal(await page.locator('.premium-inspector').isVisible(), false, 'departed private card inspector must clear');
await page.evaluate(() => { fixture.connected = false; window.paint(); });
assert.equal(await page.locator('.premium-hand-body').count(), 0);
assert.equal(await page.locator('.premium-hand-inspect').count(), 0);
assert.doesNotMatch(await page.locator('.premium-sr-only').textContent(), /Tu mano:/);
assert.deepEqual(failures, []);
for (const viewport of [{ width: 844, height: 390 }, { width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
  await page.setViewportSize(viewport);
  await page.evaluate(() => { fixture.connected = true; window.prompt('size', 'envidiaBottomOrder'); });
  const undersized = await page.locator('#premium-ui button:visible').evaluateAll(buttons => buttons.map(b => ({ id: b.dataset.controlId, rect: b.getBoundingClientRect() })).filter(b => b.rect.width < 43.9 || b.rect.height < 43.9).map(b => b.id));
  assert.deepEqual(undersized, [], `44px minimum hit areas at ${viewport.width}×${viewport.height}`);
}
await browser.close();
console.log('Premium DOM regressions passed: declaration, focus, inspection, ordered choices, sealed privacy, timeout and four viewport sizes.');
