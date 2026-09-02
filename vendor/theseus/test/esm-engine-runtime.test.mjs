import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ensureGlobal = (name, value) => {
  if (globalThis[name] === undefined) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value,
      writable: true
    });
  }
};

const installBrowserLikeGlobals = () => {
  ensureGlobal('window', globalThis);
  ensureGlobal('document', {
    body: {},
    createElement: () => ({
      getContext: () => null,
      style: {}
    }),
    getElementById: () => null,
    getElementsByTagName: () => [],
    location: { href: 'http://localhost/' },
    readyState: 'complete'
  });
  ensureGlobal('navigator', { maxTouchPoints: 0, userAgent: 'node' });
  ensureGlobal('screen', { availHeight: 0, availWidth: 0 });
  ensureGlobal('Image', class Image {});
  ensureGlobal('Audio', class Audio {
    canPlayType() {
      return '';
    }
  });
  ensureGlobal('XMLHttpRequest', class XMLHttpRequest {});
};

test('ESM engine entry exposes window.ig and ig.main', async () => {
  installBrowserLikeGlobals();

  const moduleUrl =
    `${pathToFileURL(path.resolve('public/lib/impact/impact.js')).href}?test=${Date.now()}`;
  const engineModule = await import(moduleUrl);

  assert.equal(engineModule.default, globalThis.window.ig);
  assert.equal(typeof engineModule.default.main, 'function');
  assert.equal(typeof engineModule.default.Game.extend, 'function');
  assert.equal('ig' in engineModule, false);
  assert.equal('main' in engineModule, false);
});

test('ESM engine entry resolves classes without direct ig.global lookups', async () => {
  installBrowserLikeGlobals();

  const moduleUrl =
    `${pathToFileURL(path.resolve('public/lib/impact/impact.js')).href}?test=${Date.now()}-registry`;
  const ig = (await import(moduleUrl)).default;

  const EntityRegistryTest = ig.Entity.extend({});
  ig.registerClass('EntityRegistryTest', EntityRegistryTest);

  const game = new ig.Game();
  const entity = game.spawnEntity('EntityRegistryTest', 4, 8, { name: 'registry-test' });

  assert.equal(entity instanceof EntityRegistryTest, true);
  assert.deepEqual(game.getEntitiesByType('EntityRegistryTest'), [entity]);
  assert.equal(ig.getClass('EntityRegistryTest'), EntityRegistryTest);

  const EntityLegacyFallback = ig.Entity.extend({});
  globalThis.window.EntityLegacyFallback = EntityLegacyFallback;

  assert.equal(ig.getClass('EntityLegacyFallback'), EntityLegacyFallback);
  delete globalThis.window.EntityLegacyFallback;
  assert.equal(ig.getClass('EntityLegacyFallback'), EntityLegacyFallback);
});

test('game instances expose getLevelByName while sharing the static level registry', async () => {
  installBrowserLikeGlobals();

  const moduleUrl =
    `${pathToFileURL(path.resolve('public/lib/impact/impact.js')).href}?test=${Date.now()}-levels`;
  const ig = (await import(moduleUrl)).default;

  const levelData = { entities: [], layer: [] };
  const registeredLevel = ig.Game.registerLevel('LevelRuntimeLookup', levelData);
  const game = new ig.Game();

  assert.equal(registeredLevel, levelData);
  assert.equal(ig.game, game);
  assert.equal(game.getLevelByName('runtimeLookup'), levelData);
  assert.equal(game.getLevelByName('LevelRuntimeLookup'), levelData);
  assert.equal(ig.Game.getLevelByName('runtimeLookup'), levelData);
});
