import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  buildEntityManifestArtifacts,
  buildEntityManifestEntries,
  checkEntityManifestArtifacts,
  writeEntityManifestArtifacts
} from '../tools/weltmeister/build-weltmeister-entity-manifest.mjs';

const ensureGlobal = (name, value) => {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value,
    writable: true
  });
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

    addEventListener() {}
    removeEventListener() {}
    load() {}
    pause() {}
  });
  ensureGlobal('XMLHttpRequest', class XMLHttpRequest {});
};

const makeTempProjectRoot = async () =>
  fs.mkdtemp(path.join(os.tmpdir(), 'theseus-weltmeister-entity-manifest-'));

const writeProjectFile = async (projectRoot, relativePath, contents = '') => {
  const targetPath = path.join(projectRoot, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, contents, 'utf8');
  return targetPath;
};

test('buildEntityManifestArtifacts derives sorted entries and stable import metadata', async () => {
  const projectRoot = await makeTempProjectRoot();

  await writeProjectFile(projectRoot, 'public/games/example/entities/zapper.js');
  await writeProjectFile(projectRoot, 'public/games/example/entities/blob.js');
  await writeProjectFile(projectRoot, 'public/games/example/entities/subdir/shield-wall.js');

  const artifacts = await buildEntityManifestArtifacts({
    projectRoot,
    sourceDirectories: ['public/games/example/entities']
  });

  assert.deepEqual(
    artifacts.entries.map(({ key, moduleId, className, importPath }) => ({
      key,
      moduleId,
      className,
      importPath
    })),
    [
      {
        key: 'games/example/entities/blob',
        moduleId: 'games.example.entities.blob',
        className: 'EntityBlob',
        importPath: '../../games/example/entities/blob.js'
      },
      {
        key: 'games/example/entities/subdir/shield-wall',
        moduleId: 'games.example.entities.subdir.shield-wall',
        className: 'EntityShieldWall',
        importPath: '../../games/example/entities/subdir/shield-wall.js'
      },
      {
        key: 'games/example/entities/zapper',
        moduleId: 'games.example.entities.zapper',
        className: 'EntityZapper',
        importPath: '../../games/example/entities/zapper.js'
      }
    ]
  );
});

test('writeEntityManifestArtifacts is reproducible and checkEntityManifestArtifacts detects drift', async () => {
  const projectRoot = await makeTempProjectRoot();

  await writeProjectFile(projectRoot, 'public/games/example/entities/blob.js');
  await writeProjectFile(projectRoot, 'public/games/example/entities/player.js');

  const firstWrite = await writeEntityManifestArtifacts({
    projectRoot,
    sourceDirectories: ['public/games/example/entities']
  });
  const firstModuleSource = await fs.readFile(
    path.join(projectRoot, firstWrite.moduleOutputPath),
    'utf8'
  );

  await writeEntityManifestArtifacts({
    projectRoot,
    sourceDirectories: ['public/games/example/entities']
  });
  const secondModuleSource = await fs.readFile(
    path.join(projectRoot, firstWrite.moduleOutputPath),
    'utf8'
  );

  assert.equal(firstModuleSource, secondModuleSource);

  const inSync = await checkEntityManifestArtifacts({
    projectRoot,
    sourceDirectories: ['public/games/example/entities']
  });
  assert.equal(inSync.matches, true);

  await fs.writeFile(path.join(projectRoot, firstWrite.moduleOutputPath), '// stale\n', 'utf8');
  const stale = await checkEntityManifestArtifacts({
    projectRoot,
    sourceDirectories: ['public/games/example/entities']
  });
  assert.equal(stale.matches, false);
});

test('ESM Weltmeister entity loader fetches the matching entity folder and registers classes', async (t) => {
  installBrowserLikeGlobals();
  delete globalThis.$;
  delete globalThis.wm;

  const moduleRoot = await makeTempProjectRoot();
  t.after(() => fs.rm(moduleRoot, { recursive: true, force: true }));

  const moduleToolRoot = path.join(moduleRoot, 'tools/weltmeister');
  await fs.mkdir(moduleToolRoot, { recursive: true });
  await Promise.all([
    fs.copyFile(
      path.resolve('tools/weltmeister/entities.js'),
      path.join(moduleToolRoot, 'entities.js')
    ),
    fs.copyFile(
      path.resolve('tools/weltmeister/config.js'),
      path.join(moduleToolRoot, 'config.js')
    ),
    fs.copyFile(
      path.resolve('tools/weltmeister/request.js'),
      path.join(moduleToolRoot, 'request.js')
    ),
    fs.copyFile(
      path.resolve('tools/weltmeister/wm.js'),
      path.join(moduleToolRoot, 'wm.js')
    )
  ]);
  await fs.symlink(path.resolve('public/lib'), path.join(moduleRoot, 'lib'), 'dir');
  await fs.symlink(path.resolve('public/games'), path.join(moduleRoot, 'games'), 'dir');

  const moduleUrl = `${pathToFileURL(path.join(moduleRoot, 'tools/weltmeister/entities.js')).href}?test=${Date.now()}`;
  const {
    getEntityDirectoryForLevelPath,
    getLegacyEntityModuleMap,
    listEntityManifestEntries,
    prepareWeltmeisterEntityState
  } = await import(moduleUrl);

  assert.equal(
    getEntityDirectoryForLevelPath('games/example/levels/title.js'),
    'games/example/entities'
  );
  assert.equal(
    getEntityDirectoryForLevelPath('public/games/001-autorunner/levels/start.js'),
    'games/001-autorunner/entities'
  );

  const manifestEntries = buildEntityManifestEntries({
    sourceFiles: [
      'games/example/entities/blob.js',
      'games/example/entities/levelchange.js',
      'games/example/entities/player.js'
    ]
  });
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        sourceDirectories: ['games/example/entities'],
        entities: manifestEntries
      })
    };
  };

  const prepared = await prepareWeltmeisterEntityState({
    levelPath: 'games/example/levels/title.js',
    fetchImpl
  });

  assert.deepEqual(fetchCalls, [
    '/tools/weltmeister/api/entities?dir=games%2Fexample%2Fentities'
  ]);
  assert.equal(prepared.entityDirectory, 'games/example/entities');
  assert.equal(
    prepared.entityModules['games.example.entities.blob'],
    'games/example/entities/blob.js'
  );
  assert.equal(
    globalThis.wm.entityModules['games.example.entities.player'],
    'games/example/entities/player.js'
  );
  assert.equal(
    getLegacyEntityModuleMap()['games.example.entities.levelchange'],
    'games/example/entities/levelchange.js'
  );
  assert.equal(listEntityManifestEntries().length, manifestEntries.length);

  const blobEntry = prepared.loadedEntries.find((entry) => entry.className === 'EntityBlob');
  assert.equal(typeof blobEntry?.entityClass, 'function');
  assert.equal(blobEntry?.entityClass, globalThis.ig.getClass('EntityBlob'));
});
