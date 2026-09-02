import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { discoverGames, renderGamesIndexHtml } from '../tools/bake/build-games.mjs';

const makeTempDirectory = async (prefix) =>
  fs.mkdtemp(path.join(os.tmpdir(), prefix));

const writeFile = async (rootPath, relativePath, contents = '') => {
  const targetPath = path.join(rootPath, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, contents, 'utf8');
  return targetPath;
};

test('discoverGames returns sorted immediate game folders with index.html', async (t) => {
  const gamesRoot = await makeTempDirectory('theseus-games-discovery-');
  t.after(() => fs.rm(gamesRoot, { recursive: true, force: true }));

  await writeFile(gamesRoot, 'beta/index.html', '<title>Beta Game</title>');
  await writeFile(gamesRoot, 'alpha/index.html', '<title>Alpha Game</title>');
  await writeFile(gamesRoot, '.hidden/index.html', '<title>Hidden Game</title>');
  await writeFile(gamesRoot, 'no-index/main.js');
  await writeFile(gamesRoot, 'loose-file.txt');

  const games = await discoverGames({ gamesRoot });

  assert.deepEqual(
    games.map((game) => ({
      name: game.name,
      title: game.title,
      sourcePath: game.sourcePath,
      bakedPath: game.bakedPath,
      debugPath: game.debugPath
    })),
    [
      {
        name: 'alpha',
        title: 'Alpha Game',
        sourcePath: '/games/alpha/index.html',
        bakedPath: '/dist/alpha/index.html',
        debugPath: '/games/alpha/index.html?debug'
      },
      {
        name: 'beta',
        title: 'Beta Game',
        sourcePath: '/games/beta/index.html',
        bakedPath: '/dist/beta/index.html',
        debugPath: '/games/beta/index.html?debug'
      }
    ]
  );
});

test('renderGamesIndexHtml uses the site shell and links each game variant', () => {
  const html = renderGamesIndexHtml([
    {
      name: 'example',
      title: 'Example & One',
      sourcePath: '/games/example/index.html',
      bakedPath: '/dist/example/index.html'
    },
    {
      name: 'example2',
      title: 'Example Two',
      sourcePath: '/games/example2/index.html',
      bakedPath: '/dist/example2/index.html'
    }
  ]);

  assert.match(html, /<title>Theseus Games<\/title>/);
  assert.match(html, /<header class="site-header">/);
  assert.match(html, /<a class="brand" href="\/">Theseus<\/a>/);
  assert.match(html, /<a href="\/games\.html">Games<\/a>/);
  assert.match(html, /<a href="\/docs\.html">Docs<\/a>/);
  assert.doesNotMatch(html, /<a href="\/docs\.json\?fields=keyword,title,date,tags">JSON<\/a>/);
  assert.match(html, /<main class="content">/);
  assert.doesNotMatch(html, /landing-page/);
  assert.doesNotMatch(html, /landing-content/);
  assert.doesNotMatch(html, /content--docs/);
  assert.doesNotMatch(html, /docs-layout/);
  assert.doesNotMatch(html, /docs-sidebar/);
  assert.match(html, /Example &amp; One/);
  assert.match(html, /href="\/dist\/example\/index\.html"/);
  assert.match(html, /href="\/games\/example\/index\.html"/);
  assert.match(html, /href="\/games\/example\/index\.html\?debug"/);
  assert.match(html, /href="\/dist\/example2\/index\.html"/);
  assert.match(html, /href="\/games\/example2\/index\.html"/);
  assert.match(html, /href="\/games\/example2\/index\.html\?debug"/);
});
