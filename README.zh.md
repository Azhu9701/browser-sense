# Browser Sense

<p align="center">
  <strong>AI 原生浏览器感知层</strong><br>
  API 嗅探 · 页面识别 · 录制回放 · 视觉-语义截图
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#功能特性">功能特性</a> ·
  <a href="#api-接口">API</a> ·
  <a href="#mcp-服务器">MCP</a> ·
  <a href="README.md">English</a>
</p>

---

Browser Sense 是一个 **AI 原生浏览器控制层**，将浏览器视为传感器而非遥控器。不再反复 snapshot + click，而是提供：

- **API 嗅探** — 直接捕获 JSON API 响应，跳过 DOM 解析
- **页面类型识别** — 自动判断页面类型（搜索/商品/文章/表单/视频）并提取结构化 schema
- **录制/回放** — 录制操作序列，一键复现
- **视觉-语义截图** — 截图上叠加 `@e` ref 标注，AI 一眼看到布局和可交互元素
- **MCP 服务器** — 将所有能力封装为 MCP tools，任何 AI 都能用

## 为什么用 Browser Sense？

| 现有工具的问题 | Browser Sense 的解决方案 |
|-------------|----------------------|
| AI 看不到页面变化 | 增量 DOM diff，通过 SSE 实时推送 |
| DOM 解析提取数据太脆弱 | API 嗅探 — 直接从网络层拿 JSON |
| `@e` ref 页面更新后就失效 | 缓存 ref map，操作精确命中 |
| 多行 JS 的 JSON 转义噩梦 | 从文件执行：`{"file": "/tmp/code.js"}` |
| 每个工具只能配一个 AI | MCP Server，Claude/Cursor 通用 |

## 快速开始

```bash
# 1. 克隆并安装
git clone https://github.com/azhu9701/browser-sense.git
cd browser-sense
bun install

# 2. 启动 daemon
bun daemon/server.js

# 3. 加载 Chrome 扩展
# 打开 chrome://extensions → 开启开发者模式 → 加载已解压的扩展程序 → 选择 ./extension/

# 4. 测试
curl -s http://127.0.0.1:19000/status
```

或者用一键安装脚本：
```bash
bash install.sh
```

## 功能特性

### API 嗅探

杀手级功能。拦截 JSON API 响应，跳过 DOM 解析。

```bash
# 一键嗅探：嗅探 + 导航 + 返回结构化数据
curl -s -X POST http://127.0.0.1:19000/sniff/auto \
  -d '{"url": "https://example.com", "wait": 3000}'
# → {"apiCount": 2, "apis": [{"url": "/api/products", "body": [...]}]}
```

域名过滤 — 只捕获当前标签页同域的请求。

### 页面类型识别

```bash
curl -s http://127.0.0.1:19000/detect
# → {"type": "search_results", "schema": {"results": [...]}}
# → {"type": "product", "schema": {"name": "...", "price": "..."}}
# → {"type": "article", "schema": {"title": "...", "author": "..."}}
```

支持类型：`search_results`（搜索结果）、`product`（商品）、`article`（文章）、`form`（表单）、`video`（视频）、`table`（表格）、`feed`（信息流）、`homepage`（首页）、`generic`（通用）。

### 录制 / 回放

```bash
# 录制操作序列
curl -s -X POST http://127.0.0.1:19000/record/start -d '{"name": "login-flow"}'
# ... 执行操作 ...
curl -s http://127.0.0.1:19000/record/stop

# 回放
curl -s -X POST http://127.0.0.1:19000/record/play -d '{"name": "login-flow"}'
```

### 视觉-语义截图

```bash
# 截图上标注每个可交互元素的 @e ref
curl -s "http://127.0.0.1:19000/screenshot?annotate=true"
```

## API 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/status` | GET | daemon + 扩展状态 |
| `/navigate` | POST | 打开 URL |
| `/snapshot` | GET | 无障碍树 + `@e` refs |
| `/read` | GET | 纯文本提取 |
| `/detect` | GET | 页面类型 + 结构化 schema |
| `/screenshot` | GET | 截图（加 `?annotate=true`） |
| `/execute` | POST | 执行 JS（`{"code": "..."}` 或 `{"file": "..."}`） |
| `/sniff/auto` | POST | 一键 API 嗅探 |
| `/sniff/start` | POST | 手动嗅探 |
| `/sniff/stop` | GET | 停止嗅探 |
| `/record/start` | POST | 开始录制 |
| `/record/stop` | GET | 停止并保存 |
| `/record/play` | POST | 回放录制 |
| `/record/list` | GET | 列出录制 |
| `/events` | GET | SSE 实时推送流 |

## MCP 服务器

将 Browser Sense 暴露给任何 MCP 兼容的 AI 代理：

```bash
# 启动 MCP 服务器
bun daemon/mcp-server.js

# 注册到 Claude Code
claude mcp add browser-sense -- "bun /path/to/browser-sense/daemon/mcp-server.js"
```

**可用 tools：** `browser_status`、`browser_navigate`、`browser_snapshot`、`browser_read`、`browser_detect`、`browser_click`、`browser_fill`、`browser_screenshot`、`browser_execute`、`browser_sniff_auto`、`browser_record_start`、`browser_record_stop`、`browser_record_play`、`browser_record_list`、`browser_list_tabs`、`browser_find_tab`、`browser_close_tab`。

## 架构

```
Chrome 扩展 (Manifest V3)
├── content.js      — DOM 监听器、无障碍树、文本提取、标注覆盖层、页面分类器
├── background.js   — WebSocket ↔ daemon、命令路由、网络拦截（API 嗅探）
└── popup.html      — 连接状态、快速控制

本地 Daemon (Bun/Node)
├── server.js       — HTTP API、WebSocket 服务器、录制引擎、事件广播
└── mcp-server.js   — MCP 协议包装器，暴露所有 tools
```

## 环境要求

- **Bun** ≥ 1.0.0（或 Node.js ≥ 18）
- **Chrome** 或 **Edge**（基于 Chromium）
- **macOS**、**Linux** 或 **Windows**

## 开源协议

MIT — 详见 [LICENSE](LICENSE)
