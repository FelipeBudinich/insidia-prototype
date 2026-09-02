import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const createElement = (name = 'div') => ({
  nodeName: name.toUpperCase(),
  className: '',
  childNodes: [],
  style: {},
  appendChild(child) {
    this.childNodes.push(child);
    return child;
  },
  insertBefore(child, before) {
    const index = this.childNodes.indexOf(before);
    if (index === -1) {
      this.childNodes.push(child);
    } else {
      this.childNodes.splice(index, 0, child);
    }
    return child;
  },
  addEventListener() {},
  removeEventListener() {},
  getContext() {
    return {
      beginPath() {},
      clearRect() {},
      drawImage() {},
      fillRect() {},
      fillText() {},
      lineTo() {},
      moveTo() {},
      stroke() {},
      strokeRect() {}
    };
  }
});

const installBrowserLikeGlobals = (search) => {
  const documentLocation = {
    href: `http://localhost/${search}`,
    search
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
    writable: true
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: createElement('body'),
      head: createElement('head'),
      createElement,
      createTextNode: (text) => ({ textContent: text }),
      getElementById: () => null,
      getElementsByTagName: () => [],
      location: documentLocation,
      readyState: 'complete'
    },
    writable: true
  });
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: documentLocation,
    writable: true
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { maxTouchPoints: 0, userAgent: 'node' },
    writable: true
  });
  Object.defineProperty(globalThis, 'screen', {
    configurable: true,
    value: { availHeight: 0, availWidth: 0 },
    writable: true
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    value: class HTMLElement {},
    writable: true
  });
  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    value: class Image {},
    writable: true
  });
  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    value: class Audio {
      canPlayType() {
        return '';
      }
    },
    writable: true
  });
  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    value: class XMLHttpRequest {},
    writable: true
  });
};

const importIg = async (search) => {
  installBrowserLikeGlobals(search);
  delete globalThis.ig;
  delete globalThis.__THESEUS_INCLUDE_DEBUG__;

  const url = `${pathToFileURL(path.resolve('public/lib/impact/ig.js')).href}?ig-debug-test=${Date.now()}-${Math.random()}`;
  return (await import(url)).default;
};

test('ig.js owns debug query parsing and debug import behavior', async () => {
  const normalIg = await importIg('?debug=false');
  assert.equal(await normalIg.debugReady, null);
  assert.equal(normalIg.debug, null);

  const debugIg = await importIg('?debug=true');
  assert.equal(await debugIg.debugReady, debugIg.debug);
  assert.equal(typeof debugIg.Debug, 'function');
  assert.equal(debugIg.debug instanceof debugIg.Debug, true);
});

test('impact waits for ig debug readiness before booting', async () => {
  const impactSource = await fs.readFile(
    new URL('../../../public/lib/impact/impact.js', import.meta.url),
    'utf8'
  );
  const debugReadyAwaitIndex = impactSource.search(/\bawait\s+ig\.debugReady\b/);
  const bootIndex = impactSource.search(/\big\.boot\(\)/);

  assert.ok(debugReadyAwaitIndex >= 0, 'expected impact.js to await ig.debugReady');
  assert.ok(bootIndex >= 0, 'expected impact.js to boot ig');
  assert.ok(
    debugReadyAwaitIndex < bootIndex,
    'expected debug readiness to be awaited before ig.boot()'
  );
});
