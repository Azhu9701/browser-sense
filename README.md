# Browser Sense

<p align="center">
  <strong>AI-native browser sensing layer</strong><br>
  API sniffing · Page detection · Recording/Replay · Visual-semantic screenshots
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="#api-reference">API</a> ·
  <a href="#mcp-server">MCP</a> ·
  <a href="README.zh.md">中文</a>
</p>

---

Browser Sense is an **AI-native browser control layer** that treats the browser as a sensor, not a remote. Instead of blind snapshot-and-click loops, it provides:

- **API Sniffing** — Capture JSON API responses directly, skipping DOM parsing entirely
- **Page Type Detection** — Auto-classify pages (search/product/article/form/video) and extract structured schemas
- **Recording/Replay** — Record action sequences and replay them later
- **Visual-Semantic Screenshots** — Screenshots with `@e` ref annotations overlaid on interactive elements
- **MCP Server** — Expose all capabilities as MCP tools for any AI agent (Claude, Cursor, etc.)

## Why Browser Sense?

| Problem with existing tools | Browser Sense solution |
|----------------------------|----------------------|
| AI can't see what changed on the page | Incremental DOM diff pushed via SSE |
| Parsing DOM to extract data is fragile | API sniffing — get JSON directly from network |
| `@e` refs break when page updates | Cached ref map stays stable across operations |
| Multi-line JS is a JSON escaping nightmare | Execute from file: `{"file": "/tmp/code.js"}` |
| Each tool only works with one AI | MCP Server works with Claude, Cursor, and any MCP client |

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/azhu9701/browser-sense.git
cd browser-sense
bun install

# 2. Start the daemon
bun daemon/server.js

# 3. Load the Chrome extension
# Open chrome://extensions → Enable Developer mode → Load unpacked → Select ./extension/

# 4. Test
curl -s http://127.0.0.1:19000/status
```

Or use the one-liner installer:
```bash
bash install.sh
```

## Features

### API Sniffing

The killer feature. Intercept JSON API responses and skip DOM parsing.

```bash
# One-call: sniff + navigate + return structured data
curl -s -X POST http://127.0.0.1:19000/sniff/auto \
  -d '{"url": "https://example.com", "wait": 3000}'
# → {"apiCount": 2, "apis": [{"url": "/api/products", "body": [...]}]}
```

Domain-filtered — only captures requests from the same domain as the active tab.

### Page Type Detection

```bash
curl -s http://127.0.0.1:19000/detect
# → {"type": "search_results", "schema": {"results": [...]}}
# → {"type": "product", "schema": {"name": "...", "price": "..."}}
# → {"type": "article", "schema": {"title": "...", "author": "..."}}
```

Supported types: `search_results`, `product`, `article`, `form`, `video`, `table`, `feed`, `homepage`, `generic`.

### Recording / Replay

```bash
# Record a sequence
curl -s -X POST http://127.0.0.1:19000/record/start -d '{"name": "login-flow"}'
# ... perform actions ...
curl -s http://127.0.0.1:19000/record/stop

# Replay
curl -s -X POST http://127.0.0.1:19000/record/play -d '{"name": "login-flow"}'
```

### Visual-Semantic Screenshots

```bash
# Screenshot with @e ref labels on every interactive element
curl -s "http://127.0.0.1:19000/screenshot?annotate=true"
```

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Daemon + extension health |
| `/navigate` | POST | Open URL |
| `/snapshot` | GET | Accessibility tree with `@e` refs |
| `/read` | GET | Plain text extraction |
| `/detect` | GET | Page type + structured schema |
| `/screenshot` | GET | Screenshot (use `?annotate=true`) |
| `/execute` | POST | Run JS (`{"code": "..."}` or `{"file": "..."}`) |
| `/sniff/auto` | POST | One-call API sniffing |
| `/sniff/start` | POST | Manual sniffing |
| `/sniff/stop` | GET | Stop sniffing |
| `/record/start` | POST | Start recording |
| `/record/stop` | GET | Stop and save |
| `/record/play` | POST | Replay recording |
| `/record/list` | GET | List recordings |
| `/events` | GET | SSE stream for real-time push |

## MCP Server

Expose Browser Sense to any MCP-compatible AI agent:

```bash
# Start MCP server
bun daemon/mcp-server.js

# Register with Claude Code
claude mcp add browser-sense -- "bun /path/to/browser-sense/daemon/mcp-server.js"
```

**Available tools:** `browser_status`, `browser_navigate`, `browser_snapshot`, `browser_read`, `browser_detect`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_execute`, `browser_sniff_auto`, `browser_record_start`, `browser_record_stop`, `browser_record_play`, `browser_record_list`, `browser_list_tabs`, `browser_find_tab`, `browser_close_tab`.

## Architecture

```
Chrome Extension (Manifest V3)
├── content.js      — DOM observer, a11y tree, text extraction, annotation overlay, page classifier
├── background.js   — WebSocket ↔ daemon, command router, network interception (API sniffing)
└── popup.html      — Connection status, quick controls

Local Daemon (Bun/Node)
├── server.js       — HTTP API, WebSocket server, recording engine, event broadcasting
└── mcp-server.js   — MCP protocol wrapper exposing all tools
```

## Requirements

- **Bun** ≥ 1.0.0 (or Node.js ≥ 18)
- **Chrome** or **Edge** (Chromium-based)
- **macOS**, **Linux**, or **Windows**

## License

MIT — see [LICENSE](LICENSE)
