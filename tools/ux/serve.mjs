import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const repository = fileURLToPath(new URL('../../', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const isTool = pathname === '/' || pathname.startsWith('/tools/ux/');
    if (!isTool && !pathname.startsWith('/games/insidia/') && !pathname.startsWith('/lib/')) {
      response.writeHead(404).end(); return;
    }
    const root = isTool ? path.join(repository, 'tools/ux') : path.join(repository, 'public');
    const relative = pathname === '/' ? 'index.html' : isTool ? pathname.slice('/tools/ux/'.length) : pathname.slice(1);
    const file = path.resolve(root, decodeURIComponent(relative));
    if (!file.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(content);
  } catch { response.writeHead(404).end('Fixture resource unavailable'); }
});
server.listen(Number(process.env.UX_PORT ?? 8789), '127.0.0.1', () => {
  process.stdout.write(`Local UX fixture runner: http://127.0.0.1:${server.address().port}\n`);
});
