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

installBrowserLikeGlobals();

const moduleUrl =
  `${pathToFileURL(path.resolve('public/lib/impact/impact.js')).href}?font-test=${Date.now()}`;
const ig = (await import(moduleUrl)).default;

ig.system = {
  scale: 1,
  context: {
    globalAlpha: 1,
    drawImage() {}
  },
  getDrawPos(position) {
    return position;
  }
};

const createFont = () => {
  const font = Object.create(ig.Font.prototype);

  font.loaded = true;
  font.firstChar = 32;
  font.height = 10;
  font.lineSpacing = 2;
  font.letterSpacing = 0;
  font.alpha = 1;
  font._visualTop = 2;
  font._visualBottom = 6;
  font._visualHeight = 5;
  font.indices = new Array(128).fill(0);
  font.widthMap = new Array(128).fill(1);
  font.topMap = new Array(128).fill(2);
  font.bottomMap = new Array(128).fill(6);
  font.heightMap = new Array(128).fill(5);
  font.drawnChars = [];
  font._drawChar = function(charIndex, targetX, targetY, letterSpacing) {
    const spacing = typeof letterSpacing === 'number' && Number.isFinite(letterSpacing)
      ? letterSpacing
      : this.letterSpacing;

    this.drawnChars.push({
      char: String.fromCharCode(charIndex + this.firstChar),
      x: targetX,
      y: targetY
    });

    return this.widthMap[charIndex] + spacing;
  };

  return font;
};

const fontCharIndex = (font, character) => character.charCodeAt(0) - font.firstChar;

const drawnLines = (font) => {
  const lines = [];

  for (const record of font.drawnChars) {
    let line = lines.find((entry) => entry.y === record.y);
    if (!line) {
      line = { text: '', y: record.y };
      lines.push(line);
    }

    line.text += record.char;
  }

  return lines;
};

test('loadGlyphVisualMetrics builds per-glyph maps with blank fallback', () => {
  const font = Object.create(ig.Font.prototype);
  const imageWidth = 3;
  const visualHeight = 4;
  const pixelData = new Uint8ClampedArray(imageWidth * visualHeight * 4);

  font.widthMap = [2, 1];
  font.indices = [0, 2];
  font.getImagePixels = () => ({ data: pixelData });

  pixelData[(1 * imageWidth + 0) * 4 + 3] = 255;
  pixelData[(3 * imageWidth + 1) * 4 + 3] = 255;

  font._loadGlyphVisualMetrics(imageWidth, visualHeight + 2);

  assert.deepEqual(font.topMap, [1, 0]);
  assert.deepEqual(font.bottomMap, [3, 3]);
  assert.deepEqual(font.heightMap, [3, 4]);
});

test('draw keeps legacy horizontal alignment and defaults to font ink alignment', () => {
  const font = createFont();
  ig.Image.drawCount = 0;

  font.draw('abcd', 20, 50, ig.Font.ALIGN.CENTER);

  assert.deepEqual(font.drawnChars, [
    { char: 'a', x: 18, y: 53 },
    { char: 'b', x: 19, y: 53 },
    { char: 'c', x: 20, y: 53 },
    { char: 'd', x: 21, y: 53 }
  ]);
  assert.equal(ig.Image.drawCount, 4);
});

test('draw applies top, middle, and bottom ink alignment inside each line', () => {
  const yPositionsFor = (verticalAlign) => {
    const font = createFont();

    font.draw('a\nb', 0, 100, { verticalAlign });

    return drawnLines(font).map((line) => line.y);
  };

  assert.deepEqual(yPositionsFor(ig.Font.VALIGN.TOP), [98, 110]);
  assert.deepEqual(yPositionsFor(ig.Font.VALIGN.MIDDLE), [100.5, 112.5]);
  assert.deepEqual(yPositionsFor(ig.Font.VALIGN.BOTTOM), [103, 115]);
  assert.deepEqual(yPositionsFor(ig.Font.VALIGN.FONT), [103, 115]);
});

test('draw aligns top, middle, and bottom with per-character ink metrics', () => {
  const yPositionsFor = (verticalAlign) => {
    const font = createFont();
    const a = fontCharIndex(font, 'a');
    const b = fontCharIndex(font, 'b');

    font.topMap[a] = 1;
    font.bottomMap[a] = 3;
    font.heightMap[a] = 3;
    font.topMap[b] = 4;
    font.bottomMap[b] = 8;
    font.heightMap[b] = 5;

    font.draw('ab', 0, 100, { verticalAlign });

    return font.drawnChars.map((record) => record.y);
  };

  assert.deepEqual(yPositionsFor(ig.Font.VALIGN.TOP), [99, 96]);
  assert.deepEqual(yPositionsFor(ig.Font.VALIGN.MIDDLE), [102.5, 98.5]);
  assert.deepEqual(yPositionsFor(ig.Font.VALIGN.BOTTOM), [106, 101]);
  assert.deepEqual(yPositionsFor(ig.Font.VALIGN.FONT), [103, 103]);
});

test('draw uses stable full-cell metrics when a glyph visual map is missing', () => {
  const font = createFont();
  const space = fontCharIndex(font, ' ');

  font.topMap[space] = undefined;
  font.bottomMap[space] = undefined;
  font.heightMap[space] = undefined;
  font.draw(' ', 0, 20, { verticalAlign: ig.Font.VALIGN.MIDDLE });

  assert.deepEqual(font.drawnChars, [
    { char: ' ', x: 0, y: 20 }
  ]);
});

test('draw uses per-call lineSpacing for explicit multiline advance', () => {
  const font = createFont();

  font.draw('a\nb', 0, 0, {
    lineSpacing: 5,
    verticalAlign: ig.Font.VALIGN.TOP
  });

  assert.deepEqual(drawnLines(font), [
    { text: 'a', y: -2 },
    { text: 'b', y: 13 }
  ]);
});

test('draw uses per-call lineSpacing for wrapped line advance', () => {
  const font = createFont();

  font.draw('one two three', 0, 0, {
    lineSpacing: 4,
    maxWidth: 7,
    verticalAlign: ig.Font.VALIGN.TOP
  });

  assert.deepEqual(drawnLines(font), [
    { text: 'one two', y: -2 },
    { text: 'three', y: 12 }
  ]);
});

test('per-call lineSpacing does not mutate the font property', () => {
  const font = createFont();

  font.draw('a\nb', 0, 0, {
    lineSpacing: 5,
    verticalAlign: ig.Font.VALIGN.TOP
  });

  assert.equal(font.lineSpacing, 2);
});

test('draw uses per-call letterSpacing for glyph advance', () => {
  const font = createFont();

  font.draw('abc', 0, 0, {
    letterSpacing: 2,
    verticalAlign: ig.Font.VALIGN.TOP
  });

  assert.deepEqual(font.drawnChars, [
    { char: 'a', x: 0, y: -2 },
    { char: 'b', x: 3, y: -2 },
    { char: 'c', x: 6, y: -2 }
  ]);
});

test('per-call letterSpacing does not mutate the font property', () => {
  const font = createFont();

  font.draw('ab', 0, 0, {
    letterSpacing: 2,
    verticalAlign: ig.Font.VALIGN.TOP
  });

  assert.equal(font.letterSpacing, 0);
});

test('draw uses per-call alpha and restores global alpha', () => {
  const font = createFont();
  const appliedAlphas = [];
  ig.system.context.globalAlpha = 1;
  font._drawChar = function(charIndex, targetX, targetY, letterSpacing) {
    const spacing = typeof letterSpacing === 'number' && Number.isFinite(letterSpacing)
      ? letterSpacing
      : this.letterSpacing;

    appliedAlphas.push(ig.system.context.globalAlpha);
    return this.widthMap[charIndex] + spacing;
  };

  font.draw('ab', 0, 0, { alpha: 0.4 });

  assert.deepEqual(appliedAlphas, [0.4, 0.4]);
  assert.equal(ig.system.context.globalAlpha, 1);
  assert.equal(font.alpha, 1);
});

test('invalid per-call alpha falls back to font alpha', () => {
  const font = createFont();
  const appliedAlphas = [];
  font.alpha = 0.25;
  ig.system.context.globalAlpha = 1;
  font._drawChar = function(charIndex, targetX, targetY, letterSpacing) {
    const spacing = typeof letterSpacing === 'number' && Number.isFinite(letterSpacing)
      ? letterSpacing
      : this.letterSpacing;

    appliedAlphas.push(ig.system.context.globalAlpha);
    return this.widthMap[charIndex] + spacing;
  };

  font.draw('a', 0, 0, { alpha: Number.POSITIVE_INFINITY });

  assert.deepEqual(appliedAlphas, [0.25]);
  assert.equal(ig.system.context.globalAlpha, 1);
  assert.equal(font.alpha, 0.25);
});

test('draw aligns lines inside maxWidth when maxWidth is provided', () => {
  const centeredFont = createFont();
  const rightFont = createFont();

  centeredFont.draw('ab', 10, 0, {
    align: ig.Font.ALIGN.CENTER,
    maxWidth: 6,
    verticalAlign: ig.Font.VALIGN.TOP
  });
  rightFont.draw('ab', 10, 0, {
    align: ig.Font.ALIGN.RIGHT,
    maxWidth: 6,
    verticalAlign: ig.Font.VALIGN.TOP
  });

  assert.deepEqual(centeredFont.drawnChars, [
    { char: 'a', x: 12, y: -2 },
    { char: 'b', x: 13, y: -2 }
  ]);
  assert.deepEqual(rightFont.drawnChars, [
    { char: 'a', x: 14, y: -2 },
    { char: 'b', x: 15, y: -2 }
  ]);
});

test('draw preserves legacy center and right x anchoring without maxWidth', () => {
  const centeredFont = createFont();
  const rightFont = createFont();

  centeredFont.draw('ab', 10, 0, {
    align: ig.Font.ALIGN.CENTER,
    verticalAlign: ig.Font.VALIGN.TOP
  });
  rightFont.draw('ab', 10, 0, {
    align: ig.Font.ALIGN.RIGHT,
    verticalAlign: ig.Font.VALIGN.TOP
  });

  assert.deepEqual(centeredFont.drawnChars, [
    { char: 'a', x: 9, y: -2 },
    { char: 'b', x: 10, y: -2 }
  ]);
  assert.deepEqual(rightFont.drawnChars, [
    { char: 'a', x: 8, y: -2 },
    { char: 'b', x: 9, y: -2 }
  ]);
});

test('draw wraps before the overflowing word', () => {
  const font = createFont();

  font.draw('one two three', 0, 100, {
    maxWidth: 7,
    verticalAlign: ig.Font.VALIGN.TOP
  });

  assert.deepEqual(drawnLines(font), [
    { text: 'one two', y: 98 },
    { text: 'three', y: 110 }
  ]);
});

test('draw drops leading whitespace on wrapped lines', () => {
  const font = createFont();

  font.draw('one   two', 0, 0, {
    maxWidth: 5,
    verticalAlign: ig.Font.VALIGN.TOP
  });

  assert.deepEqual(drawnLines(font), [
    { text: 'one', y: -2 },
    { text: 'two', y: 10 }
  ]);
});

test('draw preserves explicit newlines while wrapping each source line', () => {
  const font = createFont();

  font.draw('one two\n three four', 0, 0, {
    maxWidth: 7,
    verticalAlign: ig.Font.VALIGN.TOP
  });

  assert.deepEqual(drawnLines(font), [
    { text: 'one two', y: -2 },
    { text: ' three', y: 10 },
    { text: 'four', y: 22 }
  ]);
});

test('draw keeps oversized words intact', () => {
  const font = createFont();

  font.draw('longword x', 0, 0, {
    maxWidth: 4,
    verticalAlign: ig.Font.VALIGN.TOP
  });

  assert.deepEqual(drawnLines(font), [
    { text: 'longword', y: -2 },
    { text: 'x', y: 10 }
  ]);
});

test('widthForString uses per-call letterSpacing and falls back for invalid values', () => {
  const font = createFont();

  assert.equal(font.widthForString('abc', { letterSpacing: 2 }), 7);

  font.letterSpacing = 3;
  assert.equal(font.widthForString('ab', { letterSpacing: Number.POSITIVE_INFINITY }), 5);
});

test('wrapping uses per-call letterSpacing', () => {
  const font = createFont();

  font.draw('one two', 0, 0, {
    letterSpacing: 1,
    maxWidth: 10,
    verticalAlign: ig.Font.VALIGN.TOP
  });

  assert.deepEqual(drawnLines(font), [
    { text: 'one', y: -2 },
    { text: 'two', y: 10 }
  ]);
  assert.equal(font.widthForString('one two', { letterSpacing: 1, maxWidth: 10 }), 5);
  assert.equal(font.heightForString('one two', { letterSpacing: 1, maxWidth: 10 }), 22);
});

test('widthForString and heightForString measure wrapped text', () => {
  const font = createFont();
  const options = { maxWidth: 7 };

  assert.equal(font.widthForString('one two three', options), 7);
  assert.equal(font.heightForString('one two three', options), 22);
});

test('heightForString uses per-call lineSpacing and falls back for invalid values', () => {
  const font = createFont();

  assert.equal(
    font.heightForString('one two three', { maxWidth: 7, lineSpacing: 5 }),
    25
  );
  assert.equal(
    font.heightForString('one two three', { maxWidth: 7, lineSpacing: Number.POSITIVE_INFINITY }),
    22
  );
});
