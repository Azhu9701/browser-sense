#!/usr/bin/env bun
// Browser Sense — MCP Server
// Wraps Browser Sense HTTP API as MCP tools for any AI agent

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const API = 'http://127.0.0.1:19000';

async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return res.json();
}

const server = new Server(
  { name: 'browser-sense', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

// ── Tool Definitions ──

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'browser_status',
      description: 'Check Browser Sense daemon and extension connection status',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'browser_navigate',
      description: 'Open a URL in the browser',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL to open' } },
        required: ['url']
      }
    },
    {
      name: 'browser_snapshot',
      description: 'Get accessibility tree with @e refs for interactive elements',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'browser_read',
      description: 'Extract page text content (readability mode)',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'browser_detect',
      description: 'Detect page type (search/article/product/form/video/table/feed/homepage) and extract structured schema',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'browser_click',
      description: 'Click an element by @e ref or CSS selector',
      inputSchema: {
        type: 'object',
        properties: { selector: { type: 'string', description: '@e ref (e.g. @e3) or CSS selector' } },
        required: ['selector']
      }
    },
    {
      name: 'browser_fill',
      description: 'Fill text into an input field',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: '@e ref or CSS selector' },
          value: { type: 'string', description: 'Text to fill' }
        },
        required: ['selector', 'value']
      }
    },
    {
      name: 'browser_screenshot',
      description: 'Take a screenshot. Set annotate=true for visual-semantic labels.',
      inputSchema: {
        type: 'object',
        properties: { annotate: { type: 'boolean', description: 'Add @e ref labels on elements' } }
      }
    },
    {
      name: 'browser_execute',
      description: 'Execute JavaScript in the page',
      inputSchema: {
        type: 'object',
        properties: { code: { type: 'string', description: 'JS code to execute' } },
        required: ['code']
      }
    },
    {
      name: 'browser_sniff_auto',
      description: 'Auto-sniff: navigate to URL, capture JSON API responses, return structured data. Best for data extraction.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate' },
          wait: { type: 'number', description: 'Wait time in ms (default 3000)' }
        },
        required: ['url']
      }
    },
    {
      name: 'browser_record_start',
      description: 'Start recording browser actions',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Recording name' } }
      }
    },
    {
      name: 'browser_record_stop',
      description: 'Stop recording and save',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'browser_record_play',
      description: 'Replay a saved recording',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Recording name' },
          delay: { type: 'number', description: 'Delay between steps in ms (default 500)' }
        },
        required: ['name']
      }
    },
    {
      name: 'browser_record_list',
      description: 'List saved recordings',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'browser_list_tabs',
      description: 'List all open browser tabs',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'browser_find_tab',
      description: 'Find a tab by URL',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL substring to match' } },
        required: ['url']
      }
    },
    {
      name: 'browser_close_tab',
      description: 'Close current tab',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'browser_scroll',
      description: 'Scroll page or element. Use to: bottom, top, or by deltaY.',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', enum: ['bottom', 'top'], description: 'Scroll direction' },
          deltaY: { type: 'number', description: 'Pixels to scroll' },
          selector: { type: 'string', description: 'Element to scroll (default: page)' }
        }
      }
    },
    {
      name: 'browser_press_key',
      description: 'Press a key (Enter, Escape, Tab, ArrowUp, etc.)',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key name (e.g. Enter, Escape, Tab)' },
          ctrlKey: { type: 'boolean' },
          shiftKey: { type: 'boolean' }
        },
        required: ['key']
      }
    },
    {
      name: 'browser_wait_for',
      description: 'Wait for element or text to appear on page',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to wait for' },
          text: { type: 'string', description: 'Text to wait for in page body' },
          timeout: { type: 'number', description: 'Timeout in ms (default 10000)' }
        }
      }
    },
    {
      name: 'browser_upload',
      description: 'Upload files to a file input element via CDP',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'File input selector (default: input[type="file"])' },
          files: { type: 'array', items: { type: 'string' }, description: 'Array of absolute file paths' }
        },
        required: ['files']
      }
    }
  ]
}));

// ── Tool Execution ──

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    switch (name) {
      case 'browser_status':
        result = await api('/status');
        break;
      case 'browser_navigate':
        result = await api('/navigate', 'POST', args);
        break;
      case 'browser_snapshot':
        result = await api('/snapshot');
        break;
      case 'browser_read':
        result = await api('/read');
        break;
      case 'browser_detect':
        result = await api('/detect');
        break;
      case 'browser_click':
        result = await api('/command', 'POST', { action: 'click', args });
        break;
      case 'browser_fill':
        result = await api('/command', 'POST', { action: 'fill', args });
        break;
      case 'browser_screenshot':
        result = await api(`/screenshot${args?.annotate ? '?annotate=true' : ''}`);
        break;
      case 'browser_execute':
        result = await api('/execute', 'POST', args);
        break;
      case 'browser_sniff_auto':
        result = await api('/sniff/auto', 'POST', args);
        break;
      case 'browser_record_start':
        result = await api('/record/start', 'POST', args || {});
        break;
      case 'browser_record_stop':
        result = await api('/record/stop');
        break;
      case 'browser_record_play':
        result = await api('/record/play', 'POST', args);
        break;
      case 'browser_record_list':
        result = await api('/record/list');
        break;
      case 'browser_list_tabs':
        result = await api('/command', 'POST', { action: 'list_tabs' });
        break;
      case 'browser_find_tab':
        result = await api('/command', 'POST', { action: 'find_tab', args });
        break;
      case 'browser_close_tab':
        result = await api('/command', 'POST', { action: 'close_tab' });
        break;
      case 'browser_scroll':
        result = await api('/scroll', 'POST', args);
        break;
      case 'browser_press_key':
        result = await api('/press_key', 'POST', args);
        break;
      case 'browser_wait_for':
        result = await api('/wait_for', 'POST', args);
        break;
      case 'browser_upload':
        result = await api('/upload', 'POST', args);
        break;
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    return {
      content: [{
        type: 'text',
        text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      }]
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true
    };
  }
});

// ── Start ──

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[Browser Sense MCP] Server started');
