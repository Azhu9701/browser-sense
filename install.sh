#!/bin/bash
set -e

echo "==> Browser Sense Installer"
echo ""

# 1. Start daemon
echo "[1/3] Starting daemon..."
if pgrep -f "browser-sense/daemon/server.js" > /dev/null; then
  echo "  ✓ Daemon already running"
else
  nohup bun ~/browser-sense/daemon/server.js > /tmp/browser-sense-daemon.log 2>&1 &
  sleep 1
  if pgrep -f "browser-sense/daemon/server.js" > /dev/null; then
    echo "  ✓ Daemon started (PID: $(pgrep -f 'browser-sense/daemon/server.js'))"
  else
    echo "  ✗ Daemon failed to start. Check /tmp/browser-sense-daemon.log"
    exit 1
  fi
fi

# 2. Install Claude Code skill
echo "[2/3] Installing Claude Code skill..."
SKILL_DIR="$HOME/.claude/skills/browser-sense"
rm -rf "$SKILL_DIR"
cp -r ~/browser-sense/skill "$SKILL_DIR"
echo "  ✓ Skill installed to $SKILL_DIR"

# 3. Register MCP server
echo "[3/4] Registering MCP server..."
cd ~/browser-sense && bun add @modelcontextprotocol/sdk > /dev/null 2>&1
claude mcp add browser-sense -- "bun $HOME/browser-sense/daemon/mcp-server.js" 2>/dev/null || echo "  (MCP already registered or claude CLI not available)"
echo "  ✓ MCP server registered"

# 4. Print Chrome extension instructions
echo "[4/4] Chrome Extension:"
echo "  Open chrome://extensions in Chrome"
echo "  Enable 'Developer mode' (top right)"
echo "  Click 'Load unpacked' and select: ~/browser-sense/extension"
echo "  The Browser Sense icon should turn green when connected"
echo ""
echo "==> Done! Test with: curl -s http://127.0.0.1:19000/status"
