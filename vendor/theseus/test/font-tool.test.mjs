import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBaselineGlyphPlacement,
  buildDefaultOutputPath,
  buildMetricAlphaRow,
  buildProjectFontOutputPath,
  buildSharedBaselineMetrics,
  buildValidationSampleText,
  FONT_OUTPUT_PATH_STORAGE_KEY,
  getExpectedGlyphCount,
  getFontOutputFileNameFromPath,
  getFontOutputPickerStart,
  normalizeFontOutputFileName,
  normalizeFontOutputPath,
  normalizeGlyphTextMetrics,
  parseMetricAlphaRow,
  readPersistedFontOutputPath,
  slugifyFontName,
  validateAtlasMetrics,
  writePersistedFontOutputPath
} from '../tools/font-tool/font-tool.js';

const createMemoryStorage = (entries = {}) => {
  const values = new Map(Object.entries(entries));

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
};

test('getExpectedGlyphCount returns the contiguous range size', () => {
  assert.equal(getExpectedGlyphCount(32, 126), 95);
  assert.equal(getExpectedGlyphCount(48, 57), 10);
  assert.equal(getExpectedGlyphCount(90, 65), 0);
});

test('slugifyFontName and buildDefaultOutputPath create stable example media font paths', () => {
  assert.equal(slugifyFontName('Fredoka One'), 'fredoka-one');
  assert.equal(slugifyFontName(' 04b03 '), '04b03');
  assert.equal(
    buildDefaultOutputPath('Fredoka One'),
    'games/example/media/fredoka-one.font.png'
  );
  assert.equal(buildDefaultOutputPath(''), 'games/example/media/font.font.png');
});

test('project font output helpers build games-rooted PNG paths', () => {
  assert.equal(
    buildProjectFontOutputPath({
      directoryPath: 'games/example/media',
      fileName: 'fredoka-one.font'
    }),
    'games/example/media/fredoka-one.font.png'
  );
  assert.equal(
    buildProjectFontOutputPath({
      directoryPath: 'games/001-autorunner/media/generated',
      fileName: 'runner.font.png'
    }),
    'games/001-autorunner/media/generated/runner.font.png'
  );
  assert.equal(
    normalizeFontOutputPath(' ./games/example/media/font.font.png '),
    'games/example/media/font.font.png'
  );
});

test('project font output helpers select existing PNG names', () => {
  assert.equal(
    getFontOutputFileNameFromPath('games/example/media/existing.font.png'),
    'existing.font.png'
  );
  assert.equal(normalizeFontOutputFileName('new-font'), 'new-font.png');
});

test('project font output helpers reject empty and traversal-like filenames', () => {
  assert.throws(
    () => buildProjectFontOutputPath({
      directoryPath: 'games/example/media',
      fileName: ''
    }),
    /Filename must be a PNG file name/
  );
  assert.throws(
    () => buildProjectFontOutputPath({
      directoryPath: 'games/example/media',
      fileName: '../evil'
    }),
    /Filename must be a PNG file name/
  );
  assert.throws(
    () => buildProjectFontOutputPath({
      directoryPath: 'public/games',
      fileName: 'font'
    }),
    /Output folder must stay inside games/
  );
});

test('project font output helpers derive picker start from current path', () => {
  assert.deepEqual(
    getFontOutputPickerStart('games/001-autorunner/media/generated/runner.font.png'),
    {
      directoryPath: 'games/001-autorunner/media/generated',
      fileName: 'runner.font.png'
    }
  );
  assert.deepEqual(
    getFontOutputPickerStart('public/font.png'),
    {
      directoryPath: 'games',
      fileName: 'font.font.png'
    }
  );
});

test('persisted font output path restores only valid games-rooted PNG paths', () => {
  const validStorage = createMemoryStorage({
    [FONT_OUTPUT_PATH_STORAGE_KEY]: ' ./games/example/media/font.font.png '
  });
  const invalidStorage = createMemoryStorage({
    [FONT_OUTPUT_PATH_STORAGE_KEY]: 'public/font.font.png'
  });

  assert.equal(
    readPersistedFontOutputPath(validStorage),
    'games/example/media/font.font.png'
  );
  assert.equal(readPersistedFontOutputPath(invalidStorage), null);
  assert.equal(readPersistedFontOutputPath(null), null);
});

test('persisted font output path stores selected normalized paths', () => {
  const storage = createMemoryStorage();
  const selectedPath = buildProjectFontOutputPath({
    directoryPath: 'games/example/media',
    fileName: 'new-font'
  });

  assert.equal(
    writePersistedFontOutputPath(storage, selectedPath),
    'games/example/media/new-font.png'
  );
  assert.equal(
    storage.getItem(FONT_OUTPUT_PATH_STORAGE_KEY),
    'games/example/media/new-font.png'
  );
  assert.equal(writePersistedFontOutputPath(storage, 'public/font.png'), null);
  assert.equal(
    storage.getItem(FONT_OUTPUT_PATH_STORAGE_KEY),
    'games/example/media/new-font.png'
  );
});

test('parseMetricAlphaRow mirrors ig.Font metric parsing without a trailing separator', () => {
  const alphaRow = buildMetricAlphaRow([3, 1, 4]);
  const parsed = parseMetricAlphaRow(alphaRow);

  assert.deepEqual(parsed.widthMap, [3, 1, 4]);
  assert.deepEqual(parsed.indices, [0, 4, 6]);
  assert.equal(parsed.endsWithOpaqueRun, true);
});

test('parseMetricAlphaRow exposes the classic extra zero-width glyph caused by a trailing separator', () => {
  const alphaRowWithTrailingSeparator = [...buildMetricAlphaRow([2, 5]), 0];
  const parsed = parseMetricAlphaRow(alphaRowWithTrailingSeparator);

  assert.deepEqual(parsed.widthMap, [2, 5, 0]);
  assert.deepEqual(parsed.indices, [0, 3, 9]);
  assert.equal(parsed.endsWithOpaqueRun, false);
});

test('shared baseline metrics use one baseline for glyphs with different ascents', () => {
  const fontSize = 16;
  const tallGlyph = normalizeGlyphTextMetrics({
    width: 9,
    actualBoundingBoxAscent: 12,
    actualBoundingBoxDescent: 2,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: 9
  }, fontSize);
  const lowGlyph = normalizeGlyphTextMetrics({
    width: 8,
    actualBoundingBoxAscent: 7,
    actualBoundingBoxDescent: 5,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: 8
  }, fontSize);
  const baseline = buildSharedBaselineMetrics([tallGlyph, lowGlyph], fontSize);
  const tallPlacement = buildBaselineGlyphPlacement({
    glyphMetrics: tallGlyph,
    baselineMetrics: baseline,
    fontSize
  });
  const lowPlacement = buildBaselineGlyphPlacement({
    glyphMetrics: lowGlyph,
    baselineMetrics: baseline,
    fontSize
  });

  assert.equal(baseline.ascent, 12);
  assert.equal(baseline.descent, 5);
  assert.equal(tallPlacement.drawY, lowPlacement.drawY);
});

test('baseline placement preserves descenders below the shared baseline', () => {
  const fontSize = 16;
  const capGlyph = normalizeGlyphTextMetrics({
    width: 10,
    actualBoundingBoxAscent: 12,
    actualBoundingBoxDescent: 0,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: 10
  }, fontSize);
  const descenderGlyph = normalizeGlyphTextMetrics({
    width: 8,
    actualBoundingBoxAscent: 7,
    actualBoundingBoxDescent: 5,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: 8
  }, fontSize);
  const baseline = buildSharedBaselineMetrics([capGlyph, descenderGlyph], fontSize);
  const capPlacement = buildBaselineGlyphPlacement({
    glyphMetrics: capGlyph,
    baselineMetrics: baseline,
    fontSize
  });
  const descenderPlacement = buildBaselineGlyphPlacement({
    glyphMetrics: descenderGlyph,
    baselineMetrics: baseline,
    fontSize
  });

  assert.equal(capPlacement.drawY, descenderPlacement.drawY);
  assert.notEqual(capPlacement.expectedMinY, descenderPlacement.expectedMinY);
  assert.ok(descenderPlacement.expectedMinY > capPlacement.expectedMinY);
  assert.ok(descenderPlacement.expectedMaxY > capPlacement.expectedMaxY);
});

test('glyph metric normalization falls back when text bounds are missing', () => {
  const fontSize = 16;
  const glyphMetrics = normalizeGlyphTextMetrics({ width: 0 }, fontSize);
  const baseline = buildSharedBaselineMetrics([glyphMetrics], fontSize);

  assert.deepEqual(glyphMetrics, {
    ascent: 16,
    descent: 8,
    left: 0,
    measuredWidth: 8,
    padding: 32,
    right: 12
  });
  assert.equal(baseline.ascent, 16);
  assert.equal(baseline.descent, 8);
  assert.equal(baseline.baselineY, 48);
});

test('validateAtlasMetrics rejects spacing and count problems that would break runtime parsing', () => {
  const parsedMetrics = parseMetricAlphaRow(buildMetricAlphaRow([2, 3, 4]));

  assert.deepEqual(
    validateAtlasMetrics({
      parsedMetrics,
      expectedGlyphCount: 3,
      firstChar: 48,
      lastChar: 50,
      spacerRowAlphas: [0, 0, 0, 0]
    }),
    {
      ok: true,
      glyphCountMatches: true,
      spacerRowTransparent: true,
      lastMetricRunTouchesEdge: true,
      spaceWidthNonZero: true
    }
  );

  assert.deepEqual(
    validateAtlasMetrics({
      parsedMetrics: parseMetricAlphaRow([...buildMetricAlphaRow([2, 3, 4]), 0]),
      expectedGlyphCount: 3,
      firstChar: 48,
      lastChar: 50,
      spacerRowAlphas: [0, 0, 0, 0]
    }),
    {
      ok: false,
      glyphCountMatches: false,
      spacerRowTransparent: true,
      lastMetricRunTouchesEdge: false,
      spaceWidthNonZero: true
    }
  );

  assert.deepEqual(
    validateAtlasMetrics({
      parsedMetrics: {
        widthMap: [0, 3, 4],
        indices: [0, 1, 5],
        endsWithOpaqueRun: true
      },
      expectedGlyphCount: 3,
      firstChar: 32,
      lastChar: 34,
      spacerRowAlphas: [0, 0, 0, 0]
    }),
    {
      ok: false,
      glyphCountMatches: true,
      spacerRowTransparent: true,
      lastMetricRunTouchesEdge: true,
      spaceWidthNonZero: false
    }
  );
});

test('buildValidationSampleText only uses printable characters from the exported range', () => {
  assert.equal(buildValidationSampleText(48, 57), '0123456789');
  assert.equal(buildValidationSampleText(10, 13), '');
});
