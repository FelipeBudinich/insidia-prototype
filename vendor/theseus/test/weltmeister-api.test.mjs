import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  browseEntityManifest,
  browseFiles,
  normalizeEntitySourceDirectory,
  saveImageFile,
  saveFile
} from '../tools/weltmeister/api/node-api.mjs';

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HwAGgwJ/lbn4WQAAAABJRU5ErkJggg==';
const ONE_BY_ONE_PNG_DATA_URL = `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`;
const ONE_BY_ONE_PNG_BUFFER = Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64');

const makeTempProjectRoot = async () =>
  fs.mkdtemp(path.join(os.tmpdir(), 'theseus-weltmeister-api-'));

const writeProjectFile = async (projectRoot, relativePath, contents = '') => {
  const targetPath = path.join(projectRoot, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, contents, 'utf8');
  return targetPath;
};

test('saveFile writes .js files relative to the configured project root', async (t) => {
  const projectRoot = await makeTempProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await fs.mkdir(path.join(projectRoot, 'games/example/levels'), { recursive: true });

  const result = await saveFile({
    projectRoot,
    filePath: 'games/example/levels/test-level.js',
    data: 'export default 1;\n'
  });

  assert.deepEqual(result, { error: 0 });
  assert.equal(
    await fs.readFile(path.join(projectRoot, 'games/example/levels/test-level.js'), 'utf8'),
    'export default 1;\n'
  );
});

test('saveFile writes .json files relative to the configured project root', async (t) => {
  const projectRoot = await makeTempProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await fs.mkdir(path.join(projectRoot, 'games/example/levels'), { recursive: true });

  const data = '{\n  "entities": [],\n  "layer": []\n}\n';
  const result = await saveFile({
    projectRoot,
    filePath: 'games/example/levels/test-level.json',
    data
  });

  assert.deepEqual(result, { error: 0 });
  assert.equal(
    await fs.readFile(path.join(projectRoot, 'games/example/levels/test-level.json'), 'utf8'),
    data
  );
});

test('saveFile strips traversal markers but keeps writes rooted inside the project', async (t) => {
  const projectRoot = await makeTempProjectRoot();
  const sandboxRoot = path.dirname(projectRoot);
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await fs.mkdir(path.join(projectRoot, 'games/example/levels'), { recursive: true });

  const result = await saveFile({
    projectRoot,
    filePath: '../games/example/levels/safe.js',
    data: 'safe = true;\n'
  });

  assert.deepEqual(result, { error: 0 });
  assert.equal(
    await fs.readFile(path.join(projectRoot, 'games/example/levels/safe.js'), 'utf8'),
    'safe = true;\n'
  );
  await assert.rejects(fs.access(path.join(sandboxRoot, 'games/example/levels/safe.js')));
});

test('saveFile preserves the .js/.json level suffix constraint', async (t) => {
  const projectRoot = await makeTempProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const result = await saveFile({
    projectRoot,
    filePath: 'games/example/levels/not-allowed.txt',
    data: '{}'
  });

  assert.deepEqual(result, {
    error: '3',
    msg: 'File must have a .js or .json suffix'
  });
});

test('saveImageFile writes valid PNG files inside example game media', async (t) => {
  const projectRoot = await makeTempProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const result = await saveImageFile({
    projectRoot,
    filePath: 'games/example/media/generated/test.font.png',
    data: ONE_BY_ONE_PNG_DATA_URL
  });

  assert.deepEqual(result, {
    error: 0,
    path: 'games/example/media/generated/test.font.png'
  });
  assert.deepEqual(
    await fs.readFile(path.join(projectRoot, 'games/example/media/generated/test.font.png')),
    ONE_BY_ONE_PNG_BUFFER
  );
});

test('saveImageFile writes valid PNG files inside any game folder', async (t) => {
  const projectRoot = await makeTempProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const result = await saveImageFile({
    projectRoot,
    filePath: 'games/001-autorunner/media/generated/test.font.png',
    data: ONE_BY_ONE_PNG_DATA_URL
  });

  assert.deepEqual(result, {
    error: 0,
    path: 'games/001-autorunner/media/generated/test.font.png'
  });
  assert.deepEqual(
    await fs.readFile(path.join(projectRoot, 'games/001-autorunner/media/generated/test.font.png')),
    ONE_BY_ONE_PNG_BUFFER
  );
});

test('saveImageFile rejects non-PNG image paths', async (t) => {
  const projectRoot = await makeTempProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const result = await saveImageFile({
    projectRoot,
    filePath: 'games/example/media/generated/test.font.gif',
    data: ONE_BY_ONE_PNG_DATA_URL
  });

  assert.deepEqual(result, {
    error: '3',
    msg: 'File must have a .png suffix'
  });
});

test('saveImageFile rejects writes outside games', async (t) => {
  const projectRoot = await makeTempProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const result = await saveImageFile({
    projectRoot,
    filePath: 'public/generated.font.png',
    data: ONE_BY_ONE_PNG_DATA_URL
  });

  assert.deepEqual(result, {
    error: '4',
    msg: 'Image path must stay inside games/'
  });
});

test('saveImageFile rejects traversal-shaped image paths', async (t) => {
  const projectRoot = await makeTempProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  const result = await saveImageFile({
    projectRoot,
    filePath: '../games/example/media/generated/test.font.png',
    data: ONE_BY_ONE_PNG_DATA_URL
  });

  assert.deepEqual(result, {
    error: '4',
    msg: 'Image path must stay inside games/'
  });
});

test('browseFiles returns image and script listings for Weltmeister pickers', async (t) => {
  const projectRoot = await makeTempProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeProjectFile(projectRoot, 'games/example/media/hero.png');
  await writeProjectFile(projectRoot, 'games/example/media/readme.txt');
  await writeProjectFile(projectRoot, 'games/example/media/.hidden.png');
  await writeProjectFile(projectRoot, 'games/example/media/scripts/player.js');
  await writeProjectFile(projectRoot, 'games/example/media/scripts/player.json');
  await fs.mkdir(path.join(projectRoot, 'games/example/media/backgrounds'), { recursive: true });

  assert.deepEqual(
    await browseFiles({
      projectRoot,
      dir: 'games/example/media',
      type: 'images'
    }),
    {
      parent: 'games/example',
      dirs: ['games/example/media/backgrounds', 'games/example/media/scripts'],
      files: ['games/example/media/hero.png']
    }
  );

  assert.deepEqual(
    await browseFiles({
      projectRoot,
      dir: 'games/example/media/scripts',
      type: 'scripts'
    }),
    {
      parent: 'games/example/media',
      dirs: [],
      files: [
        'games/example/media/scripts/player.js',
        'games/example/media/scripts/player.json'
      ]
    }
  );
});

test('browseEntityManifest returns entities from the requested game entity folder', async (t) => {
  const projectRoot = await makeTempProjectRoot();
  t.after(() => fs.rm(projectRoot, { recursive: true, force: true }));

  await writeProjectFile(projectRoot, 'games/example/entities/blob.js');
  await writeProjectFile(projectRoot, 'games/example/entities/player.js');
  await writeProjectFile(projectRoot, 'games/001-autorunner/entities/runner.js');
  await writeProjectFile(projectRoot, 'games/001-autorunner/entities/readme.txt');

  assert.equal(
    normalizeEntitySourceDirectory('public/games/example/entities'),
    'games/example/entities'
  );
  assert.equal(
    normalizeEntitySourceDirectory('games/001-autorunner/entities'),
    'games/001-autorunner/entities'
  );
  assert.equal(normalizeEntitySourceDirectory('games/example/levels'), '');

  assert.deepEqual(
    await browseEntityManifest({
      projectRoot,
      dir: 'games/001-autorunner/entities'
    }),
    {
      sourceDirectories: ['games/001-autorunner/entities'],
      entities: [
        {
          key: 'games/001-autorunner/entities/runner',
          moduleId: 'games.001-autorunner.entities.runner',
          filePath: 'games/001-autorunner/entities/runner.js',
          importPath: '../../games/001-autorunner/entities/runner.js',
          className: 'EntityRunner',
          displayName: 'Runner'
        }
      ]
    }
  );
});
