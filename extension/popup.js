const dot = document.getElementById('dot');
const label = document.getElementById('label');
const detail = document.getElementById('detail');

async function checkStatus() {
  try {
    const res = await fetch('http://127.0.0.1:19000/status');
    const data = await res.json();
    dot.className = 'dot green';
    label.textContent = 'Daemon connected';
    detail.textContent = `Tabs: ${data.tabs?.length || 0} | v${data.version || '?'}`;
  } catch {
    dot.className = 'dot red';
    label.textContent = 'Daemon offline';
    detail.textContent = 'Start: bun ~/browser-sense/daemon/server.js';
  }
}

document.getElementById('test').addEventListener('click', checkStatus);

document.getElementById('sniff').addEventListener('click', async () => {
  try {
    const res = await fetch('http://127.0.0.1:19000/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sniff_start', args: {} })
    });
    const data = await res.json();
    detail.textContent = data.ok ? 'API Sniffing ON' : `Error: ${data.error}`;
  } catch {
    detail.textContent = 'Daemon not running';
  }
});

checkStatus();
