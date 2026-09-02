import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  buildLevelSave,
  ensureLevelFileExtension,
  getLevelFileFormat,
  normalizeLevelOutputFormat,
  parseLevelSource
} from '../tools/weltmeister/level-format.js';

test('parseLevelSource reads current ESM level modules through the embedded JSON markers', async () => {
  const source = await fs.readFile(path.resolve('public/games/example/levels/title.js'), 'utf8');
  const levelData = parseLevelSource(source);

  assert.equal(Array.isArray(levelData.entities), true);
  assert.equal(Array.isArray(levelData.layer), true);
  assert.equal(levelData.layer.length > 0, true);
});

test('buildLevelSave keeps .json paths explicit and round-trips their contents', () => {
  const levelData = {
    entities: [{ type: 'EntityBlob', x: 32, y: 64 }],
    layer: []
  };

  const save = buildLevelSave({
    filePath: 'games/example/levels/editor-check.json',
    levelData,
    outputFormat: 'esm'
  });

  assert.equal(save.filePath, 'games/example/levels/editor-check.json');
  assert.equal(save.format, 'json');
  assert.deepEqual(parseLevelSource(save.source), levelData);
});

test('buildLevelSave emits native ESM module output for .js paths', () => {
  const levelData = {
    entities: [{ type: 'EntityPlayer', x: 4, y: 8 }],
    layer: [
      {
        name: 'main',
        width: 1,
        height: 1,
        linkWithCollision: false,
        visible: true,
        tilesetName: 'games/example/media/tiles-70.png',
        repeat: false,
        preRender: false,
        distance: 1,
        tilesize: 70,
        foreground: false,
        data: [[1]]
      }
    ]
  };

  const save = buildLevelSave({
    filePath: 'games/example/levels/editor-check',
    levelData,
    outputFormat: 'esm',
    prettyPrint: false
  });

  assert.equal(save.filePath, 'games/example/levels/editor-check.js');
  assert.equal(save.format, 'esm');
  assert.match(save.source, /import ig from "\.\.\/\.\.\/\.\.\/lib\/impact\/impact\.js";/);
  assert.match(save.source, /ig\.Game\.registerLevel\("LevelEditorCheck", LevelEditorCheck\);/);
  assert.deepEqual(parseLevelSource(save.source), levelData);
});

test('level file format helpers keep extension-based format selection explicit', () => {
  assert.equal(getLevelFileFormat('games/example/levels/test.json', 'esm'), 'json');
  assert.equal(getLevelFileFormat('games/example/levels/test.js', 'json'), 'esm');
  assert.equal(
    ensureLevelFileExtension('games/example/levels/test', 'json'),
    'games/example/levels/test.json'
  );
  assert.equal(
    ensureLevelFileExtension('games/example/levels/test', 'esm'),
    'games/example/levels/test.js'
  );
  assert.throws(
    () => normalizeLevelOutputFormat('module'),
    /Unsupported Weltmeister level output format: module/
  );
});
