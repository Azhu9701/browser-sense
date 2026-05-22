// Browser Sense — Daemon
// Bun HTTP + WebSocket server on port 19000
// Relays commands to Chrome extension, pushes events to AI clients

import { createServer } from 'http';
import { writeFile, mkdir, readFile, readdir, appendFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';

// ── Config ──
const CONFIG_DIR = `${process.env.HOME}/.browser-sense`;
const CONFIG_PATH = `${CONFIG_DIR}/config.json`;
const AUDIT_LOG = `${CONFIG_DIR}/audit.log`;

let config = { port: 19000, screenshotDir: '/tmp/browser-sense-screenshots' };

try {
  if (existsSync(CONFIG_PATH)) {
    config = { ...config, ...JSON.parse(await readFile(CONFIG_PATH, 'utf-8')) };
  }
} catch {}

const PORT = config.port;
const SCREENSHOT_DIR = config.screenshotDir;
const RECORDINGS_DIR = `${process.env.HOME}/browser-sense/recordings`;

await mkdir(CONFIG_DIR, { recursive: true });
await mkdir(SCREENSHOT_DIR, { recursive: true });
await mkdir(RECORDINGS_DIR, { recursive: true });

// ── Audit Log ──
async function audit(action, args, result) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    action,
    args: typeof args === 'object' ? JSON.stringify(args).slice(0, 500) : String(args).slice(0, 500),
    ok: result?.ok
  }) + '\n';
  try { await appendFile(AUDIT_LOG, line); } catch {}
}

let extensionWs = null;
const aiClients = new Map(); // id -> ws
let lastAutoSniffData = null;

// ── Recording State ──
let isRecording = false;
let currentRecording = [];
let recordingName = null;

// ── HTTP Server ──

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (url.pathname === '/status' && req.method === 'GET') {
      json(res, {
        ok: true,
        version: '0.1.0',
        extensionConnected: !!extensionWs,
        aiClients: aiClients.size
      });
      return;
    }

    if (url.pathname === '/command' && req.method === 'POST') {
      const body = await readBody(req);
      const msg = typeof body === 'string' ? JSON.parse(body) : body;

      // Record this action if recording is active
      if (isRecording && msg.action !== 'sniff_start' && msg.action !== 'sniff_stop' && msg.action !== 'sniff_get') {
        currentRecording.push({
          action: msg.action,
          args: msg.args,
          tabId: msg.tabId,
          timestamp: Date.now()
        });
      }

      const result = await sendToExtension(msg);
      json(res, result);
      return;
    }

    // Convenience endpoints (shortcuts to /command)
    if (url.pathname === '/navigate' && req.method === 'POST') {
      const args = await readBody(req);
      const result = await sendToExtension({ action: 'navigate', args });
      json(res, result);
      return;
    }

    if (url.pathname === '/snapshot' && req.method === 'GET') {
      const result = await sendToExtension({ action: 'snapshot' });
      json(res, result);
      return;
    }

    if (url.pathname === '/read' && req.method === 'GET') {
      const result = await sendToExtension({ action: 'read' });
      json(res, result);
      return;
    }

    if (url.pathname === '/screenshot' && req.method === 'GET') {
      const annotate = url.searchParams.get('annotate') === 'true';
      const result = await sendToExtension({ action: 'screenshot', args: { annotate } });
      if (result.ok && result.data?.dataUrl) {
        // Decode base64, save to disk, return path
        const matches = result.data.dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const buf = Buffer.from(matches[2], 'base64');
          const suffix = annotate ? '-annotated' : '';
          const path = `${SCREENSHOT_DIR}/${Date.now()}${suffix}.${ext}`;
          await writeFile(path, buf);
          json(res, { ok: true, path, size: buf.length, annotated: annotate });
          return;
        }
      }
      json(res, result);
      return;
    }

    if (url.pathname === '/sniff/start' && req.method === 'POST') {
      const result = await sendToExtension({ action: 'sniff_start', args: await readBody(req) });
      json(res, result);
      return;
    }

    if (url.pathname === '/sniff/stop' && req.method === 'GET') {
      const result = await sendToExtension({ action: 'sniff_stop' });
      json(res, result);
      return;
    }

    if (url.pathname === '/sniff' && req.method === 'GET') {
      const result = await sendToExtension({ action: 'sniff_get' });
      json(res, result);
      return;
    }

    if (url.pathname === '/sniff/auto' && req.method === 'POST') {
      // One-call: start sniffing → navigate → wait → collect → stop
      const args = await readBody(req);
      const targetUrl = args.url;
      if (!targetUrl) { json(res, { ok: false, error: 'url required' }); return; }

      // 1. Start sniffing
      const sniffResult = await sendToExtension({ action: 'sniff_start', args: {} });
      if (!sniffResult.ok) { json(res, sniffResult); return; }
      const tabId = sniffResult.data.tabId;

      // 2. Navigate
      const navResult = await sendToExtension({ action: 'navigate', args: { url: targetUrl }, tabId });
      if (!navResult.ok) {
        await sendToExtension({ action: 'sniff_stop', tabId });
        json(res, navResult); return;
      }

      // 3. Wait extra for JS to finish loading APIs
      await new Promise(r => setTimeout(r, args.wait || 3000));

      // 4. Collect + stop
      const sniffData = await sendToExtension({ action: 'sniff_get', tabId });
      await sendToExtension({ action: 'sniff_stop', tabId });

      const apis = sniffData.data || [];
      json(res, {
        ok: true,
        data: {
          url: targetUrl,
          tabId,
          apiCount: apis.length,
          apis: apis.map(a => ({
            url: a.url,
            status: a.status,
            bodyPreview: typeof a.body === 'string' ? a.body.slice(0, 500) : a.body,
            isStructured: a.isStructured
          }))
        }
      });

      // Also store full bodies for retrieval
      lastAutoSniffData = apis;
      return;
    }

    if (url.pathname === '/sniff/data' && req.method === 'GET') {
      json(res, { ok: true, data: lastAutoSniffData || [] });
      return;
    }

    if (url.pathname === '/upload' && req.method === 'POST') {
      const args = await readBody(req);
      const result = await sendToExtension({
        action: 'upload',
        args: {
          selector: args.selector || 'input[type="file"]',
          files: args.files || []
        }
      });
      json(res, result);
      return;
    }

    if (url.pathname === '/scroll' && req.method === 'POST') {
      const args = await readBody(req);
      const result = await sendToExtension({ action: 'scroll', args });
      json(res, result);
      return;
    }

    if (url.pathname === '/press_key' && req.method === 'POST') {
      const args = await readBody(req);
      const result = await sendToExtension({ action: 'press_key', args });
      json(res, result);
      return;
    }

    if (url.pathname === '/wait_for' && req.method === 'POST') {
      const args = await readBody(req);
      const selector = args.selector;
      const text = args.text;
      const timeout = args.timeout || 10000;
      const interval = args.interval || 500;

      const start = Date.now();
      while (Date.now() - start < timeout) {
        let found = false;
        try {
          if (selector) {
            const result = await sendToExtension({ action: 'execute', args: { code: `!!document.querySelector("${selector.replace(/"/g, '\\"')}")` } });
            found = result.ok && result.data === true;
          } else if (text) {
            const result = await sendToExtension({ action: 'execute', args: { code: `document.body.innerText.includes("${text.replace(/"/g, '\\"')}")` } });
            found = result.ok && result.data === true;
          }
        } catch {}

        if (found) {
          json(res, { ok: true, waited: Date.now() - start });
          return;
        }
        await new Promise(r => setTimeout(r, interval));
      }

      json(res, { ok: false, error: `timeout after ${timeout}ms` });
      return;
    }

    if (url.pathname === '/execute' && req.method === 'POST') {
      const args = await readBody(req);
      // Support: {"code": "..."} or raw JS string or {"file": "/path/to/script.js"}
      let code = '';
      if (typeof args === 'string') {
        code = args;
      } else if (args.file) {
        code = await readFile(args.file, 'utf-8');
      } else {
        code = args.code || '';
      }
      const result = await sendToExtension({ action: 'execute', args: { code } });
      json(res, result);
      return;
    }

    // ── Page Type Detection ──
    if (url.pathname === '/detect' && req.method === 'GET') {
      const result = await sendToExtension({ action: 'detect' });
      json(res, result);
      return;
    }

    // ── Recording ──
    if (url.pathname === '/record/start' && req.method === 'POST') {
      const args = await readBody(req);
      isRecording = true;
      currentRecording = [];
      recordingName = args.name || `recording-${Date.now()}`;
      json(res, { ok: true, name: recordingName });
      return;
    }

    if (url.pathname === '/record/stop' && req.method === 'GET') {
      isRecording = false;
      const name = recordingName;
      const steps = currentRecording.length;
      // Save to file
      const path = `${RECORDINGS_DIR}/${name}.json`;
      await writeFile(path, JSON.stringify({ name, created: Date.now(), steps: currentRecording }, null, 2));
      json(res, { ok: true, name, steps, path });
      currentRecording = [];
      return;
    }

    if (url.pathname === '/record/list' && req.method === 'GET') {
      const files = await readdir(RECORDINGS_DIR);
      const recordings = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
          const data = JSON.parse(await readFile(`${RECORDINGS_DIR}/${f}`, 'utf-8'));
          recordings.push({ name: data.name, steps: data.steps?.length || 0, created: data.created });
        } catch {}
      }
      json(res, { ok: true, data: recordings });
      return;
    }

    if (url.pathname === '/record/play' && req.method === 'POST') {
      const args = await readBody(req);
      const name = args.name;
      if (!name) { json(res, { ok: false, error: 'name required' }); return; }

      const path = `${RECORDINGS_DIR}/${name}.json`;
      if (!existsSync(path)) { json(res, { ok: false, error: 'recording not found' }); return; }

      const recording = JSON.parse(await readFile(path, 'utf-8'));
      const results = [];
      const delay = args.delay || 500; // ms between steps

      for (const step of recording.steps) {
        const result = await sendToExtension({
          action: step.action,
          args: step.args,
          tabId: step.tabId
        });
        results.push({ action: step.action, ok: result.ok });
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
      }

      json(res, { ok: true, name, stepsPlayed: results.length, results });
      return;
    }

    if (url.pathname === '/config' && req.method === 'GET') {
      json(res, { ok: true, data: config });
      return;
    }

    if (url.pathname === '/config' && req.method === 'POST') {
      const updates = await readBody(req);
      config = { ...config, ...updates };
      await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
      json(res, { ok: true, data: config });
      return;
    }

    if (url.pathname === '/audit' && req.method === 'GET') {
      try {
        const lines = (await readFile(AUDIT_LOG, 'utf-8')).split('\n').filter(Boolean).slice(-100);
        json(res, { ok: true, data: lines.map(l => JSON.parse(l)) });
      } catch {
        json(res, { ok: true, data: [] });
      }
      return;
    }

    if (url.pathname === '/events' && req.method === 'GET') {
      // SSE stream for AI clients to receive push events
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      const clientId = randomUUID();
      aiClients.set(clientId, { ws: null, sse: res });

      req.on('close', () => aiClients.delete(clientId));

      // Send initial connected event
      res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);
      return;
    }

    res.writeHead(404);
    json(res, { error: 'not found' });
  } catch (err) {
    res.writeHead(500);
    json(res, { ok: false, error: err.message });
  }
});

// ── WebSocket Upgrade ──

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/ws') {
    // Extension or AI client connects via WebSocket
    wsServer.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'register' && msg.role === 'extension') {
          extensionWs = ws;
          console.log('[daemon] Chrome extension connected');
          ws.on('close', () => { extensionWs = null; console.log('[daemon] Extension disconnected'); });
        } else if (msg.type === 'register' && msg.role === 'ai') {
          const id = msg.id || randomUUID();
          aiClients.set(id, { ws, sse: null });
          ws.on('close', () => aiClients.delete(id));
        }

        // Forward push events from extension to AI clients
        if (msg.type === 'api_response' || msg.type === 'dom_change') {
          broadcastToAI(msg);
        }
      });
    });
  }
});

import { WebSocketServer } from 'ws';
const wsServer = new WebSocketServer({ noServer: true });

// ── Send command to Chrome extension, wait for response ──

let pendingCommands = new Map();
let commandCounter = 0;

function sendToExtension(msg) {
  return new Promise((resolve, reject) => {
    if (!extensionWs) {
      audit(msg.action, msg.args, { ok: false });
      resolve({ ok: false, error: 'extension not connected' });
      return;
    }

    const id = ++commandCounter;
    const timeout = setTimeout(() => {
      pendingCommands.delete(id);
      audit(msg.action, msg.args, { ok: false });
      resolve({ ok: false, error: 'timeout (10s)' });
    }, 10000);

    pendingCommands.set(id, { resolve, timeout });

    extensionWs.send(JSON.stringify({ ...msg, id }));

    // Listen for response with matching id
    const handler = (raw) => {
      const resp = JSON.parse(raw.toString());
      if (resp.id === id) {
        extensionWs.off('message', handler);
        clearTimeout(timeout);
        pendingCommands.delete(id);
        audit(msg.action, msg.args, resp);
        resolve(resp);
      }
    };
    extensionWs.on('message', handler);
  });
}

// ── Broadcast push events to all AI clients ──

function broadcastToAI(msg) {
  const data = JSON.stringify(msg);

  for (const [id, client] of aiClients) {
    try {
      if (client.ws?.readyState === 1) {
        client.ws.send(data);
      }
      if (client.sse && !client.sse.writableEnded) {
        client.sse.write(`data: ${data}\n\n`);
      }
    } catch {}
  }
}

// ── Helpers ──

function json(res, data) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { resolve(body); }
    });
  });
}

// ── Start ──

server.listen(PORT, () => {
  console.log(`[Browser Sense] Daemon running on http://127.0.0.1:${PORT}`);
  console.log(`[Browser Sense] WebSocket: ws://127.0.0.1:${PORT}/ws`);
  console.log(`[Browser Sense] Events SSE: http://127.0.0.1:${PORT}/events`);
  console.log(`[Browser Sense] Screenshots: ${SCREENSHOT_DIR}/`);
});
