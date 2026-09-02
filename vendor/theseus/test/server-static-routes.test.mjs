import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createApp } from '../server.mjs';

const makeTempDirectory = async (prefix) =>
  fs.mkdtemp(path.join(os.tmpdir(), prefix));

const writeFile = async (rootPath, relativePath, contents) => {
  const targetPath = path.join(rootPath, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, contents, 'utf8');
  return targetPath;
};

const startTestServer = async (options = {}, t) => {
  const app = createApp(options);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      })
  );

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return { port };
};

const requestServer = ({ method = 'GET', port, path: requestPath, headers = {}, body }) =>
  new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: requestPath,
        headers
      },
      (response) => {
        const chunks = [];

        response.on('data', (chunk) => {
          chunks.push(chunk);
        });
        response.on('end', () => {
          const responseBody = Buffer.concat(chunks);
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: responseBody,
            text: responseBody.toString('utf8')
          });
        });
      }
    );

    request.on('error', reject);

    if (body) {
      request.write(body);
    }

    request.end();
  });

const assertInOrder = (text, snippets) => {
  let previousIndex = -1;
  for (const snippet of snippets) {
    const currentIndex = text.indexOf(snippet);
    assert.notEqual(currentIndex, -1, `Expected to find ${snippet}`);
    assert.ok(currentIndex > previousIndex, `Expected ${snippet} to appear in order`);
    previousIndex = currentIndex;
  }
};

test('/ serves public/index.html', async (t) => {
  const { port } = await startTestServer({}, t);
  const response = await requestServer({ port, path: '/' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.text, await fs.readFile(path.resolve('public/index.html'), 'utf8'));
});

test('source example page sets ImpactPrefix before loading the game module', async () => {
  const html = await fs.readFile(path.resolve('public/games/example/index.html'), 'utf8');
  const prefixIndex = html.indexOf("window.ImpactPrefix = '/';");
  const moduleIndex = html.indexOf('<script type="module" src="main.js"></script>');

  assert.notEqual(prefixIndex, -1);
  assert.notEqual(moduleIndex, -1);
  assert.ok(prefixIndex < moduleIndex);
});

test('/docs.html renders docs.md as the docs home', async (t) => {
  const staticRoot = await makeTempDirectory('theseus-docs-home-');
  t.after(() => fs.rm(staticRoot, { recursive: true, force: true }));

  await writeFile(
    staticRoot,
    'docs/docs.md',
    [
      '# Runtime Docs Home',
      '',
      '## Start Here',
      '',
      'This is the docs home page.'
    ].join('\n')
  );

  const { port } = await startTestServer({ staticRoot }, t);
  const response = await requestServer({ port, path: '/docs.html' });

  assert.equal(response.statusCode, 200);
  assert.match(response.text, /<a class="brand" href="\/">Theseus<\/a>/);
  assert.match(response.text, /<a href="\/games\.html">Games<\/a>/);
  assert.match(response.text, /<a href="\/docs\.html">Docs<\/a>/);
  assert.doesNotMatch(response.text, /<a href="\/docs\.json\?fields=keyword,title,date,tags">JSON<\/a>/);
  assert.match(response.text, /<h1>Runtime Docs Home<\/h1>/);
  assert.match(response.text, /<h2 id="start-here">Start Here<\/h2>/);
  assert.match(response.text, /This is the docs home page\./);
});

test('/docs entry points redirect to docs.html', async (t) => {
  const { port } = await startTestServer({}, t);

  for (const requestPath of ['/docs', '/docs/', '/docs/class-reference', '/docs/docs']) {
    const response = await requestServer({ port, path: requestPath });

    assert.equal(response.statusCode, 301);
    assert.equal(response.headers.location, '/docs.html');
  }
});

test('/docs/:keyword renders an impact-style docs sidebar', async (t) => {
  const staticRoot = await makeTempDirectory('theseus-docs-sidebar-');
  t.after(() => fs.rm(staticRoot, { recursive: true, force: true }));

  await Promise.all([
    writeFile(
      staticRoot,
      'docs/docs.md',
      [
        'title: Home Doc',
        '---',
        '# Home Doc',
        '',
        '## Home Section'
      ].join('\n')
    ),
    writeFile(
      staticRoot,
      'docs/zeta.md',
      [
        'title: Zeta Doc',
        '---',
        '# Zeta Doc',
        '',
        '## Zeta Section'
      ].join('\n')
    ),
    writeFile(
      staticRoot,
      'docs/beta.md',
      [
        'title: Beta Doc',
        '---',
        '# Beta Doc',
        '',
        '## Section One',
        '',
        '### Method Details',
        '',
        '## Section One'
      ].join('\n')
    ),
    writeFile(
      staticRoot,
      'docs/alpha.md',
      [
        'title: Alpha Doc',
        '---',
        '# Alpha Doc',
        '',
        '## Alpha Section'
      ].join('\n')
    ),
    writeFile(
      staticRoot,
      'docs/inactive.md',
      [
        'title: Inactive Doc',
        'active: false',
        '---',
        '# Inactive Doc'
      ].join('\n')
    )
  ]);

  const { port } = await startTestServer({ staticRoot }, t);
  const response = await requestServer({ port, path: '/docs/beta' });

  assert.equal(response.statusCode, 200);
  assert.match(response.text, /<a class="brand" href="\/">Theseus<\/a>/);
  assert.match(response.text, /<a href="\/games\.html">Games<\/a>/);
  assert.match(response.text, /<a href="\/docs\.html">Docs<\/a>/);
  assert.doesNotMatch(response.text, /<a href="\/docs\.json\?fields=keyword,title,date,tags">JSON<\/a>/);
  assertInOrder(response.text, [
    '<a class="docs-sidebar-link" href="/docs/alpha">Alpha Doc</a>',
    '<a class="docs-sidebar-link" href="/docs/beta" aria-current="page">Beta Doc</a>',
    '<a class="docs-sidebar-link" href="/docs/zeta">Zeta Doc</a>'
  ]);
  assert.doesNotMatch(response.text, /href="\/docs\/docs"/);
  assert.doesNotMatch(response.text, /Home Doc/);
  assert.doesNotMatch(response.text, /Inactive Doc/);
  assert.match(response.text, /<h2 id="section-one">Section One<\/h2>/);
  assert.match(response.text, /<h3 id="method-details">Method Details<\/h3>/);
  assert.match(response.text, /<h2 id="section-one-2">Section One<\/h2>/);
  assert.match(
    response.text,
    /<a class="docs-outline-link docs-outline-link--depth-2" href="#section-one">Section One<\/a>/
  );
  assert.match(
    response.text,
    /<a class="docs-outline-link docs-outline-link--depth-3" href="#method-details">Method Details<\/a>/
  );
  assert.match(
    response.text,
    /<a class="docs-outline-link docs-outline-link--depth-2" href="#section-one-2">Section One<\/a>/
  );
});

test('/games.html serves the generated baked games list when it exists', async (t) => {
  const distRoot = await makeTempDirectory('theseus-dist-route-');
  t.after(() => fs.rm(distRoot, { recursive: true, force: true }));

  await writeFile(
    distRoot,
    'index.html',
    [
      '<!doctype html>',
      '<html>',
      '<body><a href="/dist/example/index.html">Baked</a></body>',
      '</html>'
    ].join('\n')
  );

  const { port } = await startTestServer({ distRoot }, t);
  const response = await requestServer({ port, path: '/games.html' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.text, await fs.readFile(path.join(distRoot, 'index.html'), 'utf8'));
});

test('/games.html returns 404 with a bake hint when no baked build exists', async (t) => {
  const distRoot = await makeTempDirectory('theseus-empty-dist-');
  t.after(() => fs.rm(distRoot, { recursive: true, force: true }));

  const { port } = await startTestServer({ distRoot }, t);
  const response = await requestServer({ port, path: '/games.html' });

  assert.equal(response.statusCode, 404);
  assert.match(response.text, /npm run bake/);
});

test('/dist.html is not an active route', async (t) => {
  const distRoot = await makeTempDirectory('theseus-dist-old-route-');
  t.after(() => fs.rm(distRoot, { recursive: true, force: true }));

  await writeFile(
    distRoot,
    'index.html',
    [
      '<!doctype html>',
      '<html>',
      '<body><a href="/dist/example/index.html">Baked</a></body>',
      '</html>'
    ].join('\n')
  );

  const { port } = await startTestServer({ distRoot }, t);
  const response = await requestServer({ port, path: '/dist.html' });

  assert.equal(response.statusCode, 404);
  assert.notEqual(response.headers.location, '/games.html');
});

test('/games/example/media/* serves files from public/games/example/media', async (t) => {
  const { port } = await startTestServer({}, t);
  const response = await requestServer({ port, path: '/games/example/media/tiles-70.png' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    response.body,
    await fs.readFile(path.resolve('public/games/example/media/tiles-70.png'))
  );
});

test('/tools/weltmeister.html serves tools/weltmeister.html', async (t) => {
  const { port } = await startTestServer({}, t);
  const response = await requestServer({ port, path: '/tools/weltmeister.html' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.text, await fs.readFile(path.resolve('tools/weltmeister.html'), 'utf8'));
});

test('/tools/font-tool.html serves tools/font-tool.html', async (t) => {
  const { port } = await startTestServer({}, t);
  const response = await requestServer({ port, path: '/tools/font-tool.html' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.text, await fs.readFile(path.resolve('tools/font-tool.html'), 'utf8'));
});

test('/tools/weltmeister/api/* is mounted', async (t) => {
  const staticRoot = await makeTempDirectory('theseus-weltmeister-api-route-');
  t.after(() => fs.rm(staticRoot, { recursive: true, force: true }));

  await writeFile(staticRoot, 'games/example/media/hero.png', '');
  await writeFile(staticRoot, 'games/example/media/readme.txt', '');

  const { port } = await startTestServer({ staticRoot }, t);
  const response = await requestServer({
    port,
    path: '/tools/weltmeister/api/browse?dir=games/example/media&type=images'
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.text), {
    parent: 'games/example',
    dirs: [],
    files: ['games/example/media/hero.png']
  });
});
