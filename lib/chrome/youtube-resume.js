import { randomBytes } from 'crypto';
import net from 'net';
import tls from 'tls';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve } from 'path';

export const DEFAULT_CHROME_ENDPOINT = 'http://127.0.0.1:9222';
export const YOUTUBE_RESUME_SCHEMA = 'reversa.chrome_youtube_resume.v1';

export async function runYouTubeResume(options = {}) {
  const normalized = {
    endpoint: options.endpoint || DEFAULT_CHROME_ENDPOINT,
    click: Boolean(options.click),
    outDir: options.outDir || options.out || '',
    timeoutMs: Number(options.timeoutMs || options.timeout || 5000),
  };
  const targets = await listChromeTargets(normalized.endpoint, normalized.timeoutMs);
  const youtubeTargets = selectYouTubeTargets(targets);
  const actions = [];

  for (const target of youtubeTargets) {
    const expression = buildYouTubeResumeExpression({ click: normalized.click });
    const action = {
      url: target.url,
      title: target.title || '',
      timestamp: new Date().toISOString(),
      selector: 'button.ytp-play-button',
      click_requested: normalized.click,
      result: null,
    };
    try {
      const response = await evaluateChromeTarget(target, expression, normalized.timeoutMs);
      action.result = unwrapRuntimeEvaluateResult(response);
    } catch (error) {
      action.result = {
        ok: false,
        reason: 'cdp_evaluation_failed',
        error: String(error?.message || error),
      };
    }
    actions.push(action);
  }

  const clicked = actions.filter(action => action.result?.clicked).length;
  const readyDryRun = actions.filter(action => action.result?.ok && action.result?.dry_run).length;
  const failed = actions.filter(action => action.result?.ok === false).length;
  const report = {
    schema: YOUTUBE_RESUME_SCHEMA,
    generated_at: new Date().toISOString(),
    endpoint: normalized.endpoint,
    dry_run: !normalized.click,
    click_allowed: normalized.click,
    target_count: targets.length,
    youtube_target_count: youtubeTargets.length,
    classification: classifyResumeRun({ youtubeTargets, clicked, readyDryRun, failed, click: normalized.click }),
    allowed_hosts: ['youtube.com/watch', 'music.youtube.com'],
    forbidden_actions: [
      'playlist automation',
      'random page clicks',
      'hidden background autoclicking',
      'non-YouTube targets',
    ],
    actions,
  };

  if (normalized.outDir) {
    const outDir = resolve(normalized.outDir);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'chrome-youtube-resume.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(join(outDir, 'chrome-youtube-resume.md'), buildYouTubeResumeMarkdown(report), 'utf8');
  }

  return report;
}

export async function listChromeTargets(endpoint = DEFAULT_CHROME_ENDPOINT, timeoutMs = 5000) {
  const url = new URL('/json/list', endpoint.endsWith('/') ? endpoint : `${endpoint}/`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Chrome DevTools target list failed: HTTP ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(timer);
  }
}

export function selectYouTubeTargets(targets) {
  return (targets || []).filter(target => {
    if (target.type && target.type !== 'page') return false;
    if (!target.webSocketDebuggerUrl) return false;
    return isAllowedYouTubeUrl(target.url);
  });
}

export function isAllowedYouTubeUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'music.youtube.com') return true;
    const youtubeHost = host === 'youtube.com' || host === 'www.youtube.com';
    return youtubeHost && parsed.pathname === '/watch';
  } catch {
    return false;
  }
}

export function buildYouTubeResumeExpression({ click = false } = {}) {
  return `(() => {
    const clickRequested = ${click ? 'true' : 'false'};
    const host = location.hostname.toLowerCase();
    const allowed = host === 'music.youtube.com'
      || ((host === 'youtube.com' || host === 'www.youtube.com') && location.pathname === '/watch');
    if (!allowed) {
      return { ok: false, reason: 'not_allowed_youtube_target', url: location.href };
    }
    const video = document.querySelector('video');
    const buttonSelector = 'button.ytp-play-button';
    const button = document.querySelector(buttonSelector);
    const paused = video ? Boolean(video.paused) : null;
    const title = document.title || '';
    if (!clickRequested) {
      return {
        ok: true,
        dry_run: true,
        clicked: false,
        paused,
        selector: button ? buttonSelector : 'video.play()',
        title,
        url: location.href
      };
    }
    if (!video) {
      return { ok: false, reason: 'no_video_element', clicked: false, selector: buttonSelector, title, url: location.href };
    }
    if (!video.paused) {
      return { ok: true, reason: 'already_playing', clicked: false, paused, selector: buttonSelector, title, url: location.href };
    }
    if (button) {
      button.click();
    } else {
      const playResult = video.play();
      if (playResult && typeof playResult.catch === 'function') playResult.catch(() => {});
    }
    return {
      ok: true,
      clicked: true,
      paused_before: paused,
      paused_after: Boolean(video.paused),
      selector: button ? buttonSelector : 'video.play()',
      title,
      url: location.href
    };
  })();`;
}

export function buildYouTubeResumeMarkdown(report) {
  const lines = [
    '# Chrome YouTube Resume',
    '',
    `Classification: \`${report.classification}\``,
    `Dry run: \`${String(report.dry_run)}\``,
    `Endpoint: \`${report.endpoint}\``,
    `YouTube targets: \`${report.youtube_target_count}\``,
    '',
    '## Actions',
    '',
    '| URL | Click Requested | Result | Selector |',
    '| --- | --- | --- | --- |',
    ...report.actions.map(action => [
      markdownCell(action.url),
      `\`${String(action.click_requested)}\``,
      markdownCell(action.result?.reason || action.result?.ok || 'unknown'),
      `\`${action.result?.selector || action.selector}\``,
    ].join(' | ')).map(row => `| ${row} |`),
    '',
  ];
  return `${lines.join('\n')}\n`;
}

async function evaluateChromeTarget(target, expression, timeoutMs) {
  const socket = await connectChromeWebSocket(target.webSocketDebuggerUrl, timeoutMs);
  try {
    return await socket.sendCdp('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, timeoutMs);
  } finally {
    socket.close();
  }
}

function unwrapRuntimeEvaluateResult(response) {
  const result = response?.result?.result;
  if (result?.subtype === 'error') {
    return { ok: false, reason: 'runtime_error', description: result.description || result.value || '' };
  }
  if (Object.hasOwn(result ?? {}, 'value')) return result.value;
  return { ok: false, reason: 'runtime_result_missing_value' };
}

function classifyResumeRun({ youtubeTargets, clicked, readyDryRun, failed, click }) {
  if (!youtubeTargets.length) return 'CHROME_YOUTUBE_RESUME_NO_TARGETS';
  if (failed > 0 && clicked === 0 && readyDryRun === 0) return 'CHROME_YOUTUBE_RESUME_REVIEW_REQUIRED';
  if (click && clicked > 0) return 'CHROME_YOUTUBE_RESUME_CLICKED';
  if (click) return 'CHROME_YOUTUBE_RESUME_NO_CLICK_NEEDED';
  return 'CHROME_YOUTUBE_RESUME_DRY_RUN_READY';
}

function connectChromeWebSocket(wsUrl, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const parsed = new URL(wsUrl);
    const isSecure = parsed.protocol === 'wss:';
    const port = Number(parsed.port || (isSecure ? 443 : 80));
    const key = randomBytes(16).toString('base64');
    const path = `${parsed.pathname}${parsed.search}`;
    const socket = isSecure
      ? tls.connect({ host: parsed.hostname, port, servername: parsed.hostname })
      : net.connect({ host: parsed.hostname, port });
    let buffer = Buffer.alloc(0);
    let settled = false;

    const fail = error => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };

    const timer = setTimeout(() => fail(new Error(`Chrome DevTools WebSocket timed out: ${wsUrl}`)), timeoutMs);
    const onConnect = () => {
      socket.write([
        `GET ${path} HTTP/1.1`,
        `Host: ${parsed.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'));
    };

    socket.once(isSecure ? 'secureConnect' : 'connect', onConnect);
    socket.once('error', fail);
    socket.on('data', chunk => {
      if (settled) return;
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = buffer.slice(0, headerEnd).toString('utf8');
      if (!/^HTTP\/1\.1 101\b/i.test(header)) {
        fail(new Error(`Chrome DevTools WebSocket upgrade failed: ${header.split(/\r?\n/)[0]}`));
        return;
      }
      clearTimeout(timer);
      settled = true;
      const leftover = buffer.slice(headerEnd + 4);
      const connection = new ChromeWebSocketConnection(socket);
      if (leftover.length) connection.push(leftover);
      resolvePromise(connection);
    });
  });
}

class ChromeWebSocketConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.messages = [];
    this.waiters = [];
    this.nextId = 1;
    this.closed = false;
    socket.on('data', chunk => this.push(chunk));
    socket.on('close', () => {
      this.closed = true;
      this.flushWaiters(new Error('Chrome DevTools WebSocket closed'));
    });
    socket.on('error', error => this.flushWaiters(error));
  }

  async sendCdp(method, params, timeoutMs) {
    const id = this.nextId;
    this.nextId += 1;
    this.sendText(JSON.stringify({ id, method, params }));
    while (true) {
      const message = JSON.parse(await this.nextText(timeoutMs));
      if (message.id === id) return message;
    }
  }

  sendText(text) {
    const payload = Buffer.from(text, 'utf8');
    const mask = randomBytes(4);
    const header = buildClientFrameHeader(payload.length, mask);
    const masked = Buffer.alloc(payload.length);
    for (let index = 0; index < payload.length; index += 1) {
      masked[index] = payload[index] ^ mask[index % 4];
    }
    this.socket.write(Buffer.concat([header, masked]));
  }

  nextText(timeoutMs) {
    if (this.messages.length) return Promise.resolve(this.messages.shift());
    if (this.closed) return Promise.reject(new Error('Chrome DevTools WebSocket closed'));
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter(waiter => waiter.resolve !== resolvePromise);
        reject(new Error('Chrome DevTools response timed out'));
      }, timeoutMs);
      this.waiters.push({
        resolve: value => {
          clearTimeout(timer);
          resolvePromise(value);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const frame = readFrame(this.buffer);
      if (!frame) return;
      this.buffer = this.buffer.slice(frame.frameLength);
      if (frame.opcode === 1) this.enqueueMessage(frame.payload.toString('utf8'));
      if (frame.opcode === 8) this.close();
      if (frame.opcode === 9) this.sendPong(frame.payload);
    }
  }

  enqueueMessage(message) {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(message);
      return;
    }
    this.messages.push(message);
  }

  sendPong(payload) {
    const mask = randomBytes(4);
    const header = buildClientFrameHeader(payload.length, mask, 0x8a);
    const masked = Buffer.alloc(payload.length);
    for (let index = 0; index < payload.length; index += 1) {
      masked[index] = payload[index] ^ mask[index % 4];
    }
    this.socket.write(Buffer.concat([header, masked]));
  }

  close() {
    if (this.socket.destroyed) return;
    this.socket.end();
  }

  flushWaiters(error) {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) waiter.reject(error);
  }
}

function buildClientFrameHeader(payloadLength, mask, firstByte = 0x81) {
  if (payloadLength < 126) return Buffer.from([firstByte, payloadLength | 0x80, ...mask]);
  if (payloadLength < 65536) {
    const header = Buffer.alloc(4 + mask.length);
    header[0] = firstByte;
    header[1] = 126 | 0x80;
    header.writeUInt16BE(payloadLength, 2);
    mask.copy(header, 4);
    return header;
  }
  const header = Buffer.alloc(10 + mask.length);
  header[0] = firstByte;
  header[1] = 127 | 0x80;
  header.writeBigUInt64BE(BigInt(payloadLength), 2);
  mask.copy(header, 10);
  return header;
}

function readFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = Boolean(buffer[1] & 0x80);
  let payloadLength = buffer[1] & 0x7f;
  let offset = 2;
  if (payloadLength === 126) {
    if (buffer.length < offset + 2) return null;
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) return null;
    payloadLength = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }
  let mask = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.slice(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + payloadLength) return null;
  const payload = Buffer.from(buffer.slice(offset, offset + payloadLength));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }
  return { opcode, payload, frameLength: offset + payloadLength };
}

function markdownCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>');
}
