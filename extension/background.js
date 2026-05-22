// Browser Sense — Background Service Worker
// Manages WebSocket to daemon, tab lifecycle, network interception (API sniffing)

const DAEMON_WS_URL = 'ws://127.0.0.1:19000/ws';
let ws = null;
let reconnectTimer = null;
let sniffingTabs = new Map();

// ── WebSocket Connection ──

function connectDaemon() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(DAEMON_WS_URL);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'register', role: 'extension', version: '0.1.0' }));
      updateBadge('green');
    };

    ws.onmessage = async (event) => {
      await handleCommand(JSON.parse(event.data));
    };

    ws.onclose = () => { updateBadge('red'); reconnectTimer = setTimeout(connectDaemon, 3000); };
    ws.onerror = () => { updateBadge('red'); };
  } catch {
    reconnectTimer = setTimeout(connectDaemon, 3000);
  }
}

function sendToDaemon(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function updateBadge(color) {
  const c = { green: '#4CAF50', red: '#F44336', yellow: '#FF9800' };
  chrome.action.setBadgeBackgroundColor({ color: c[color] || c.yellow });
  chrome.action.setBadgeText({ text: color === 'green' ? 'ON' : '...' });
}

// ── Command Router ──

async function handleCommand(msg) {
  let res = { id: msg.id, ok: false };
  try {
    switch (msg.action) {
      case 'status':
        res = { id: msg.id, ok: true, data: { connected: true, tabs: await getTabList() } };
        break;

      case 'navigate': {
        const tab = await getOrCreateTab(msg.tabId, msg.args);
        await chrome.tabs.update(tab.id, { url: msg.args.url });
        await waitForLoad(tab.id);
        res = { id: msg.id, ok: true, data: { tabId: tab.id, url: msg.args.url } };
        break;
      }

      case 'snapshot': {
        const tid = msg.tabId || await activeTab();
        res = { id: msg.id, ok: true, data: await chrome.tabs.sendMessage(tid, { type: 'snapshot' }) };
        break;
      }

      case 'read': {
        const tid = msg.tabId || await activeTab();
        res = { id: msg.id, ok: true, data: await chrome.tabs.sendMessage(tid, { type: 'read' }) };
        break;
      }

      case 'detect': {
        const tid = msg.tabId || await activeTab();
        res = { id: msg.id, ok: true, data: await chrome.tabs.sendMessage(tid, { type: 'detect' }) };
        break;
      }

      case 'click': {
        const tid = msg.tabId || await activeTab();
        res = { id: msg.id, ok: true, data: await chrome.tabs.sendMessage(tid, { type: 'click', selector: msg.args.selector }) };
        break;
      }

      case 'fill': {
        const tid = msg.tabId || await activeTab();
        res = { id: msg.id, ok: true, data: await chrome.tabs.sendMessage(tid, { type: 'fill', selector: msg.args.selector, value: msg.args.value }) };
        break;
      }

      case 'execute': {
        const tid = msg.tabId || await activeTab();
        const results = await chrome.scripting.executeScript({
          target: { tabId: tid },
          world: 'MAIN',
          func: (code) => {
            try { return (0, eval)(code); }
            catch (e) { return { __error: e.message }; }
          },
          args: [msg.args.code]
        });
        res = { id: msg.id, ok: true, data: results[0]?.result };
        break;
      }

      case 'screenshot': {
        const tid = msg.tabId || await activeTab();
        const opts = { format: msg.args?.format || 'png' };
        if (msg.args?.quality) opts.quality = msg.args.quality;

        // If annotated mode requested, inject overlay before screenshot
        if (msg.args?.annotate) {
          await chrome.tabs.sendMessage(tid, { type: 'annotate' });
          await new Promise(r => setTimeout(r, 100)); // let canvas render
        }

        const dataUrl = await chrome.tabs.captureVisibleTab(null, opts);

        if (msg.args?.annotate) {
          await chrome.tabs.sendMessage(tid, { type: 'clear_annotations' });
        }

        res = { id: msg.id, ok: true, data: { dataUrl } };
        break;
      }

      // ── API Sniffing (the killer feature) ──
      case 'sniff_start': {
        const tid = msg.tabId || await activeTab();
        const tab = await chrome.tabs.get(tid);
        const tabDomain = new URL(tab.url).hostname;
        sniffingTabs.set(tid, {
          requests: [],
          domain: tabDomain,
          filters: msg.args?.filters || []
        });
        await chrome.debugger.attach({ tabId: tid }, '1.3');
        await chrome.debugger.sendCommand({ tabId: tid }, 'Network.enable');
        res = { id: msg.id, ok: true, data: { tabId: tid, domain: tabDomain } };
        break;
      }

      case 'sniff_stop': {
        const tid = msg.tabId || await activeTab();
        const data = sniffingTabs.get(tid);
        try { await chrome.debugger.detach({ tabId: tid }); } catch {}
        sniffingTabs.delete(tid);
        res = { id: msg.id, ok: true, data: data?.requests || [] };
        break;
      }

      case 'sniff_get': {
        const tid = msg.tabId || await activeTab();
        res = { id: msg.id, ok: true, data: sniffingTabs.get(tid)?.requests || [] };
        break;
      }

      case 'find_tab': {
        const tabs = await chrome.tabs.query({});
        const match = msg.args?.active
          ? tabs.find(t => t.active)
          : tabs.find(t => t.url.includes(msg.args.url));
        if (match) {
          await chrome.tabs.update(match.id, { active: true });
          res = { id: msg.id, ok: true, data: { tabId: match.id, url: match.url } };
        } else {
          res = { id: msg.id, ok: false, error: 'no matching tab' };
        }
        break;
      }

      case 'list_tabs':
        res = { id: msg.id, ok: true, data: await getTabList() };
        break;

      case 'close_tab': {
        const tid = msg.tabId || await activeTab();
        await chrome.tabs.remove(tid);
        res = { id: msg.id, ok: true };
        break;
      }

      default:
        res = { id: msg.id, ok: false, error: `unknown: ${msg.action}` };
    }
  } catch (err) {
    res = { id: msg.id, ok: false, error: err.message };
  }

  sendToDaemon(res);
}

// ── Network Interception — API Sniffing ──

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method !== 'Network.responseReceived') return;
  const tabData = sniffingTabs.get(source.tabId);
  if (!tabData) return;

  const ct = params.response?.headers?.['content-type'] || params.response?.mimeType || '';
  const url = params.response?.url || '';

  // Domain filter: only capture requests matching the tab's domain
  const reqDomain = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (tabData.domain && reqDomain && reqDomain !== tabData.domain && !reqDomain.endsWith('.' + tabData.domain)) return;

  const isApi = ct.includes('json') || url.includes('/api/') || url.includes('/graphql');
  if (!isApi) return;

  chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId }, (body) => {
    // Try to parse JSON for cleaner storage
    let parsed = null;
    try { parsed = JSON.parse(body?.body?.slice(0, 50000)); } catch {}

    const entry = {
      url,
      status: params.response?.status,
      contentType: ct,
      body: parsed || body?.body?.slice(0, 50000),
      isStructured: !!parsed,
      timestamp: Date.now()
    };
    tabData.requests.push(entry);

    // Real-time push to daemon → AI
    sendToDaemon({ type: 'api_response', tabId: source.tabId, data: entry });
  });
});

// ── Forward DOM changes from content script to daemon ──

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'dom_change') {
    sendToDaemon({ type: 'dom_change', tabId: sender.tab?.id, url: msg.url, changes: msg.changes });
  }
  sendResponse({ ok: true });
});

// ── Helpers ──

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function getOrCreateTab(tabId) {
  if (tabId) { try { return await chrome.tabs.get(tabId); } catch {} }
  return chrome.tabs.create({ active: true });
}

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 10000);
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(t);
        setTimeout(resolve, 500);
      }
    });
  });
}

async function getTabList() {
  return (await chrome.tabs.query({ currentWindow: true }))
    .map(t => ({ tabId: t.id, url: t.url, title: t.title, active: t.active }));
}

// ── Init ──
connectDaemon();
