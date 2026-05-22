---
name: browser-sense
description: |
  Browser Sense — AI-native browser sensing layer with API sniffing, page detection, recording/replay, and visual-semantic screenshots.
  Control the user's real browser with login sessions. Use for: browsing websites, scraping data, automating web tasks, API sniffing.
  Triggers: "browser", "webpage", "open URL", "screenshot", "sniff", "抓取", "浏览", "打开网页", "搜索", "detect", "record".
---

# Browser Sense

AI-native browser control via local daemon at `http://127.0.0.1:19000`.

## Health Check (always first)

```bash
curl -s http://127.0.0.1:19000/status
```

## Configuration

```bash
# Read current config
curl -s http://127.0.0.1:19000/config
# → {"port":19000,"screenshotDir":"/tmp/browser-sense-screenshots"}

# Update config (persisted to ~/.browser-sense/config.json)
curl -s -X POST http://127.0.0.1:19000/config \
  -d '{"defaultWait":5000}'
```

## Audit Log

All commands are logged to `~/.browser-sense/audit.log`:

```bash
# View last 100 operations
curl -s http://127.0.0.1:19000/audit
# → [{"ts":"2026-05-22T12:21:20Z","action":"navigate","ok":true}, ...]
```

- `extensionConnected: true` → healthy, proceed
- Otherwise → start daemon: `bun ~/browser-sense/daemon/server.js`, then reload extension

## Quick API

All endpoints return `{ok: true/false, data: ..., error: ...}`.

### Navigation

```bash
# Open URL (new tab)
curl -s -X POST http://127.0.0.1:19000/command \
  -H 'Content-Type: application/json' \
  -d '{"action":"navigate","args":{"url":"https://example.com"}}'

# Find existing tab
curl -s -X POST http://127.0.0.1:19000/command \
  -d '{"action":"find_tab","args":{"url":"google.com"}}'

# List all tabs
curl -s http://127.0.0.1:19000/command -d '{"action":"list_tabs"}'

# Close current tab
curl -s -X POST http://127.0.0.1:19000/command -d '{"action":"close_tab"}'
```

### Read Page

```bash
# Accessibility tree (structured, with @e refs for interaction)
curl -s http://127.0.0.1:19000/snapshot

# Plain text content (readability extraction — preferred for understanding page)
curl -s http://127.0.0.1:19000/read
```

**Prefer `/read` for understanding page content, `/snapshot` for finding interactive elements.**

### Page Type Detection

```bash
# Auto-detect page type and extract structured schema
curl -s http://127.0.0.1:19000/detect
# → {type: "search_results", schema: {resultCount: 10, results: [...]}}
# → {type: "product", schema: {name: "...", price: "...", image: "..."}}
# → {type: "article", schema: {title: "...", author: "...", contentLength: 5000}}
```

Supported types: `search_results`, `product`, `article`, `form`, `video`, `table`, `feed`, `homepage`, `generic`.

Each type returns a different schema with the most useful extracted fields.

### Interact

```bash
# Click element by @e ref or CSS selector
curl -s -X POST http://127.0.0.1:19000/command \
  -d '{"action":"click","args":{"selector":"@e3"}}'

# Fill input (handles input/textarea/contenteditable)
curl -s -X POST http://127.0.0.1:19000/command \
  -d '{"action":"fill","args":{"selector":"@e4","value":"search query"}}'

# Scroll — to bottom, top, or by pixels
curl -s -X POST http://127.0.0.1:19000/scroll \
  -d '{"to": "bottom"}'
curl -s -X POST http://127.0.0.1:19000/scroll \
  -d '{"deltaY": 800}'

# Press key — Enter, Escape, Tab, ArrowUp, etc.
curl -s -X POST http://127.0.0.1:19000/press_key \
  -d '{"key": "Enter"}'

# Wait for element or text to appear (avoids hardcoded sleep)
curl -s -X POST http://127.0.0.1:19000/wait_for \
  -d '{"selector": ".search-results", "timeout": 10000}'

# Upload files via CDP (bypasses file dialog)
curl -s -X POST http://127.0.0.1:19000/upload \
  -d '{"selector": "input[type=file]", "files": ["/path/to/image.png"]}'

# Execute JS — supports inline code, multi-line from file, or raw string
curl -s -X POST http://127.0.0.1:19000/execute \
  -H 'Content-Type: application/json' \
  -d '{"code":"document.querySelectorAll(\"h3\").length"}'

# Execute from file (avoids JSON escaping entirely)
echo 'Array.from(document.querySelectorAll("h3")).map(h=>h.innerText)' > /tmp/extract.js
curl -s -X POST http://127.0.0.1:19000/execute \
  -d '{"file":"/tmp/extract.js"}'
```

### Screenshots

```bash
# Plain screenshot — auto-saves to disk, returns path
curl -s http://127.0.0.1:19000/screenshot
# → {"ok":true,"path":"/tmp/browser-sense-screenshots/1234567890.png","size":123456}

# Visual-semantic annotated screenshot — @e ref labels on interactive elements
curl -s "http://127.0.0.1:19000/screenshot?annotate=true"
# → {"ok":true,"path":"/tmp/browser-sense-screenshots/1234567890-annotated.png","annotated":true}
```

Then use Read tool to view the image at the returned path.

## API Sniffing (Killer Feature)

Intercepts network responses and returns JSON data directly — skip DOM parsing entirely.
**Only captures requests from the same domain** as the active tab (filters out extensions, analytics, etc).

### One-call Auto-Sniff (recommended)

```bash
# Sniff + navigate + wait + return APIs in one call
curl -s -X POST http://127.0.0.1:19000/sniff/auto \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.aiman.world","wait":3000}'
# → {"ok":true,"data":{"apiCount":2,"apis":[{"url":"/api/robots/metadata","status":200,"bodyPreview":...}]}}

# Get full API bodies from last auto-sniff
curl -s http://127.0.0.1:19000/sniff/data
```

### Manual Sniffing

```bash
curl -s -X POST http://127.0.0.1:19000/sniff/start -d '{}'
# ... navigate or interact ...
curl -s http://127.0.0.1:19000/sniff
curl -s http://127.0.0.1:19000/sniff/stop
```

## Recording / Replay

Record a sequence of browser actions, save it, and replay later.

```bash
# Start recording
curl -s -X POST http://127.0.0.1:19000/record/start \
  -d '{"name":"login-flow"}'

# ... perform actions via /command (navigate, fill, click) ...
# All actions are captured automatically

# Stop recording and save
curl -s http://127.0.0.1:19000/record/stop
# → {"ok":true,"name":"login-flow","steps":5,"path":"~/browser-sense/recordings/login-flow.json"}

# List saved recordings
curl -s http://127.0.0.1:19000/record/list

# Replay a recording
curl -s -X POST http://127.0.0.1:19000/record/play \
  -d '{"name":"login-flow","delay":500}'
```

Recordings are stored in `~/browser-sense/recordings/` as JSON files.

## @e Ref System

`/snapshot` returns interactive elements with stable `@e` refs. These refs are cached — a `click(@e3)` after a snapshot resolves to the exact same element, even if the DOM changed slightly.

Always run `/snapshot` before interacting, then use the returned refs.

## MCP Server (for other AI agents)

Browser Sense ships an MCP server that exposes all tools for any AI agent:

```bash
bun ~/browser-sense/daemon/mcp-server.js
```

Add to Claude Code: `claude mcp add browser-sense -- bun ~/browser-sense/daemon/mcp-server.js`

Exposes 16 tools: `browser_status`, `browser_navigate`, `browser_snapshot`, `browser_read`, `browser_detect`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_execute`, `browser_sniff_auto`, `browser_record_start`, `browser_record_stop`, `browser_record_play`, `browser_record_list`, `browser_list_tabs`, `browser_find_tab`, `browser_close_tab`.

## Real-time Events (Push)

```bash
curl -N http://127.0.0.1:19000/events
```
