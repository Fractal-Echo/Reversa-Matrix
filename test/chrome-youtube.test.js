import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { createServer } from 'http';
import { mkdtemp, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  buildYouTubeResumeExpression,
  isAllowedYouTubeUrl,
  runYouTubeResume,
  selectYouTubeTargets,
} from '../lib/chrome/youtube-resume.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

test('YouTube resume URL guard allows only watch pages and YouTube Music', () => {
  assert.equal(isAllowedYouTubeUrl('https://www.youtube.com/watch?v=abc'), true);
  assert.equal(isAllowedYouTubeUrl('https://music.youtube.com/playlist?list=abc'), true);
  assert.equal(isAllowedYouTubeUrl('https://www.youtube.com/playlist?list=abc'), false);
  assert.equal(isAllowedYouTubeUrl('https://example.com/watch?v=abc'), false);
});

test('YouTube resume target selection requires a page websocket and allowed URL', () => {
  const targets = selectYouTubeTargets([
    { type: 'page', url: 'https://www.youtube.com/watch?v=abc', webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/1' },
    { type: 'page', url: 'https://www.youtube.com/playlist?list=abc', webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/2' },
    { type: 'service_worker', url: 'https://www.youtube.com/watch?v=abc', webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/page/3' },
    { type: 'page', url: 'https://music.youtube.com/', webSocketDebuggerUrl: '' },
  ]);

  assert.equal(targets.length, 1);
  assert.equal(targets[0].url, 'https://www.youtube.com/watch?v=abc');
});

test('YouTube resume expression is dry-run by default and click-gated explicitly', () => {
  assert.match(buildYouTubeResumeExpression(), /const clickRequested = false/);
  assert.match(buildYouTubeResumeExpression({ click: true }), /const clickRequested = true/);
});

test('YouTube resume can click a fake Chrome DevTools YouTube target', async () => {
  const fakeChrome = await startFakeChrome({
    targets: [
      { type: 'page', title: 'Video', url: 'https://www.youtube.com/watch?v=abc', id: '1' },
    ],
  });
  try {
    const report = await runYouTubeResume({ endpoint: fakeChrome.endpoint, click: true });

    assert.equal(report.classification, 'CHROME_YOUTUBE_RESUME_CLICKED');
    assert.equal(report.youtube_target_count, 1);
    assert.equal(report.actions[0].result.clicked, true);
    assert.equal(report.actions[0].result.selector, 'button.ytp-play-button');
  } finally {
    await fakeChrome.close();
  }
});

test('Chrome YouTube resume CLI writes no-target dry-run evidence', async () => {
  const fakeChrome = await startFakeChrome({ targets: [] });
  const root = await mkdtemp(join(tmpdir(), 'reversa-chrome-youtube-'));
  const outDir = join(root, 'out');
  try {
    const run = await spawnNode([
      join(repoRoot, 'bin/reversa.js'),
      'chrome',
      'youtube-resume',
      '--endpoint',
      fakeChrome.endpoint,
      '--out',
      outDir,
      '--json',
    ], {
      cwd: repoRoot,
    });

    assert.equal(run.status, 0, run.stderr || run.stdout);
    const stdout = JSON.parse(run.stdout);
    assert.equal(stdout.classification, 'CHROME_YOUTUBE_RESUME_NO_TARGETS');
    assert.equal(stdout.dry_run, true);
    assert(existsSync(join(outDir, 'chrome-youtube-resume.json')));
    assert(existsSync(join(outDir, 'chrome-youtube-resume.md')));
    const artifact = JSON.parse(await readFile(join(outDir, 'chrome-youtube-resume.json'), 'utf8'));
    assert.equal(artifact.classification, 'CHROME_YOUTUBE_RESUME_NO_TARGETS');
  } finally {
    await fakeChrome.close();
  }
});

function spawnNode(args, options = {}) {
  return new Promise(resolvePromise => {
    const child = spawn(process.execPath, args, options);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('close', status => resolvePromise({ status, stdout, stderr }));
  });
}

async function startFakeChrome({ targets }) {
  const sockets = new Set();
  const server = createServer((req, res) => {
    if (req.url !== '/json/list') {
      res.writeHead(404);
      res.end();
      return;
    }
    const port = server.address().port;
    const body = JSON.stringify(targets.map(target => ({
      ...target,
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${target.id ?? '1'}`,
    })));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
  });

  server.on('upgrade', (req, socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const key = req.headers['sec-websocket-key'];
    const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      '',
    ].join('\r\n'));
    socket.on('data', chunk => {
      const frame = readClientFrame(chunk);
      if (!frame) return;
      const request = JSON.parse(frame.toString('utf8'));
      const expression = request.params?.expression || '';
      const clicked = /const clickRequested = true/.test(expression);
      socket.write(serverTextFrame(JSON.stringify({
        id: request.id,
        result: {
          result: {
            type: 'object',
            value: {
              ok: true,
              dry_run: !clicked,
              clicked,
              paused: true,
              selector: 'button.ytp-play-button',
              url: 'https://www.youtube.com/watch?v=abc',
            },
          },
        },
      })));
    });
  });

  await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
  return {
    endpoint: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolvePromise => {
      for (const socket of sockets) socket.destroy();
      server.close(resolvePromise);
    }),
  };
}

function readClientFrame(buffer) {
  if (buffer.length < 6) return null;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    length = buffer.readUInt16BE(offset);
    offset += 2;
  }
  const mask = buffer.slice(offset, offset + 4);
  offset += 4;
  const payload = Buffer.from(buffer.slice(offset, offset + length));
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] ^= mask[index % 4];
  }
  return payload;
}

function serverTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}
