#!/bin/bash
# Browser Sense Daemon Watchdog
# Auto-restarts daemon if it crashes

DAEMON_JS="$HOME/browser-sense/daemon/server.js"
LOG_FILE="/tmp/browser-sense-daemon.log"
PID_FILE="/tmp/browser-sense-daemon.pid"

start_daemon() {
  nohup bun "$DAEMON_JS" > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  echo "[$(date)] Daemon started (PID: $!)"
}

# Check if daemon is running
check_and_restart() {
  if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ! kill -0 "$PID" 2>/dev/null; then
      echo "[$(date)] Daemon crashed, restarting..."
      start_daemon
    fi
  else
    start_daemon
  fi
}

# Initial start
check_and_restart

# Watch loop
while true; do
  sleep 5
  check_and_restart
done
