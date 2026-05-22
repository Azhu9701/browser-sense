// Browser Sense — Content Script
// Runs in page context: DOM diff, accessibility tree extraction, readability

(() => {
  if (window.__browserSenseInjected) return;
  window.__browserSenseInjected = true;

  let lastSnapshot = null;
  let observer = null;
  let refMap = new Map(); // @e ref → DOM element (stable across operations)

  // ── Accessibility Tree Extraction ──

  function buildA11yTree(root, depth = 0, maxDepth = 8) {
    if (depth > maxDepth || !root) return null;

    const node = { role: root.role || 'unknown' };
    if (root.name) node.name = root.name;
    if (root.value) node.value = root.value;

    // Assign @e ref for interactive elements
    const interactiveRoles = new Set([
      'button', 'link', 'textbox', 'combobox', 'searchbox',
      'checkbox', 'radio', 'slider', 'spinbutton', 'switch',
      'menuitem', 'tab', 'treeitem', 'option'
    ]);

    if (interactiveRoles.has(root.role)) {
      node.ref = `@e${root.nodeId || Math.random().toString(36).slice(2, 6)}`;
    }

    if (root.children && root.children.length > 0) {
      node.children = root.children
        .map(c => buildA11yTree(c, depth + 1, maxDepth))
        .filter(Boolean);
    }

    return node;
  }

  async function getA11ySnapshot() {
    try {
      const root = await chrome.runtime.sendMessage({
        type: 'get_a11y',
        tabId: null // filled by background
      });
      return root;
    } catch {
      // Fallback: manual DOM-based extraction
      return domBasedA11y();
    }
  }

  function domBasedA11y() {
    const interactive = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (el) => {
          const role = el.getAttribute('role') || el.tagName.toLowerCase();
          const interactable = el.tagName === 'A' || el.tagName === 'BUTTON' ||
            el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
            el.isContentEditable ||
            ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'switch'].includes(role);
          return interactable ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
      }
    );

    let idx = 0;
    refMap.clear(); // rebuild ref map on every snapshot
    while (walker.nextNode()) {
      const el = walker.currentNode;
      const ref = `@e${idx}`;
      refMap.set(ref, el);
      interactive.push({
        ref,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role') || getImplicitRole(el),
        name: el.getAttribute('aria-label') || el.textContent?.trim()?.slice(0, 80) || el.placeholder || '',
        value: el.value || ''
      });
      idx++;
    }

    // Also grab headings
    const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => ({
      level: parseInt(h.tagName[1]),
      text: h.textContent?.trim()?.slice(0, 120)
    }));

    return { interactive, headings, title: document.title, url: location.href };
  }

  function getImplicitRole(el) {
    const tag = el.tagName.toLowerCase();
    const map = { a: 'link', button: 'button', input: 'textbox', select: 'combobox', textarea: 'textbox' };
    return map[tag] || 'generic';
  }

  // ── Readability-style Text Extraction ──

  function extractText() {
    // Simple readability: grab article-like content
    const selectors = ['article', 'main', '[role="main"]', '.content', '#content', '.post', '.entry'];
    let root = null;
    for (const s of selectors) {
      root = document.querySelector(s);
      if (root) break;
    }
    if (!root) root = document.body;

    // Collect text nodes, skip scripts/styles/nav/footer
    const skip = new Set(['SCRIPT', 'STYLE', 'NAV', 'FOOTER', 'HEADER', 'ASIDE', 'NOSCRIPT']);
    const texts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (skip.has(node.parentElement?.tagName)) return NodeFilter.FILTER_REJECT;
        const t = node.textContent.trim();
        return t.length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    while (walker.nextNode()) {
      texts.push(walker.currentNode.textContent.trim());
    }

    return texts.join('\n');
  }

  // ── DOM Mutation Observer (Incremental Push) ──

  function startObserving() {
    if (observer) observer.disconnect();

    let debounceTimer = null;
    const pendingChanges = [];

    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        const change = {
          type: m.type,
          target: describeTarget(m.target)
        };
        if (m.type === 'childList') {
          change.added = m.addedNodes.length;
          change.removed = m.removedNodes.length;
        } else if (m.type === 'characterData') {
          change.newText = m.target.textContent?.trim()?.slice(0, 200);
        } else if (m.type === 'attributes') {
          change.attribute = m.attributeName;
        }
        pendingChanges.push(change);
      }

      // Debounce: batch changes within 300ms
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (pendingChanges.length > 0) {
          chrome.runtime.sendMessage({
            type: 'dom_change',
            changes: pendingChanges.splice(0),
            url: location.href
          }).catch(() => {});
        }
      }, 300);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'disabled']
    });
  }

  function describeTarget(node) {
    if (node === document.body) return 'body';
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return 'unknown';
    const tag = el.tagName?.toLowerCase() || '';
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? `.${el.className.split(' ').slice(0, 2).join('.')}` : '';
    return `${tag}${id}${cls}`;
  }

  // ── Message Handler ──

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'ping':
        sendResponse({ ok: true, url: location.href });
        break;

      case 'snapshot':
        sendResponse(domBasedA11y());
        break;

      case 'read':
        sendResponse({ text: extractText(), url: location.href, title: document.title });
        break;

      case 'click': {
        const el = resolveElement(msg.selector);
        if (el) { el.click(); sendResponse({ ok: true }); }
        else sendResponse({ ok: false, error: 'element not found' });
        break;
      }

      case 'fill': {
        const el = resolveElement(msg.selector);
        if (!el) { sendResponse({ ok: false, error: 'element not found' }); break; }
        if (el.isContentEditable) {
          el.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, msg.value);
          sendResponse({ ok: true, mode: 'contenteditable' });
        } else {
          el.value = msg.value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          sendResponse({ ok: true, mode: 'value' });
        }
        break;
      }

      case 'get_bbox': {
        const el = resolveElement(msg.selector);
        if (el) {
          const r = el.getBoundingClientRect();
          sendResponse({ x: r.x, y: r.y, w: r.width, h: r.height });
        } else {
          sendResponse({ ok: false });
        }
        break;
      }

      case 'annotate': {
        // Draw bounding boxes + @e refs on interactive elements
        const overlay = annotatePage();
        sendResponse({ ok: true, annotated: overlay?.count || 0 });
        break;
      }

      case 'clear_annotations': {
        clearAnnotations();
        sendResponse({ ok: true });
        break;
      }

      case 'detect': {
        sendResponse(detectPageType());
        break;
      }

      default:
        sendResponse({ error: 'unknown command' });
    }
    return true; // async sendResponse
  });

  function resolveElement(selector) {
    if (selector.startsWith('@e')) {
      // First try cached ref map (stable)
      const cached = refMap.get(selector);
      if (cached && cached.isConnected) return cached;

      // Fallback: re-query by index
      const idx = parseInt(selector.slice(2));
      const interactives = document.querySelectorAll(
        'a, button, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"]'
      );
      return interactives[idx] || null;
    }
    return document.querySelector(selector);
  }

  // ── Visual-Semantic Annotation ──

  function annotatePage() {
    clearAnnotations();

    const canvas = document.createElement('canvas');
    canvas.id = '__bs_overlay';
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;';
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;

    const ctx = canvas.getContext('2d');
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const selector = 'a, button, input, textarea, select, [role="button"], [role="link"], [contenteditable="true"], [role="combobox"], [role="textbox"]';
    const elements = document.querySelectorAll(selector);
    const colors = ['#4CAF50', '#2196F3', '#FF9800', '#E91E63', '#9C27B0', '#00BCD4'];
    let idx = 0;

    elements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 5 || rect.height < 5) return;
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;

      const color = colors[idx % colors.length];
      const ref = `@e${idx}`;

      // Bounding box
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

      // Label with @e ref
      const label = `${ref}`;
      ctx.font = 'bold 11px monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.fillRect(rect.x, rect.y - 16, tw + 8, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, rect.x + 4, rect.y - 4);

      idx++;
    });

    document.body.appendChild(canvas);
    return { count: idx };
  }

  function clearAnnotations() {
    document.getElementById('__bs_overlay')?.remove();
  }

  // ── Page Type Detection ──

  function detectPageType() {
    const u = location.href;
    const host = location.hostname;
    const path = location.pathname;

    // Signals collection
    const signals = {
      hasSearchResults: !!document.querySelector('[role="listbox"], .search-results, #search, [data-testid*="result"], ol > li:nth-child(n+3)'),
      hasArticle: !!document.querySelector('article, [role="article"], .post-content, .entry-content, .article-body'),
      hasProduct: !!document.querySelector('[itemtype*="Product"], .product-price, .add-to-cart, [data-testid*="price"], .product-detail, .sku'),
      hasForm: !!document.querySelector('form input[type="submit"], form button[type="submit"], [role="form"]'),
      hasTable: !!document.querySelector('table, [role="table"], .data-table'),
      hasList: document.querySelectorAll('ul > li, ol > li').length > 5,
      hasVideo: !!document.querySelector('video, iframe[src*="youtube"], iframe[src*="bilibili"]'),
      hasFeed: document.querySelectorAll('[class*="card"], [class*="item"], [class*="post"]').length > 3,
      metaType: document.querySelector('meta[property="og:type"]')?.content || '',
      metaSite: document.querySelector('meta[property="og:site_name"]')?.content || '',
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim() || '',
      url: u
    };

    // Classification rules (ordered by specificity)
    let type = 'generic';
    let schema = {};

    // Search engine results
    if (/google\..*\/search|baidu\.com\/s\?|bing\.com\/search|duckduckgo/.test(u) || signals.hasSearchResults) {
      type = 'search_results';
      schema = extractSearchResults();
    }
    // E-commerce product page
    else if (signals.hasProduct || /\/product\/|\/item\/|\/p\/|detail\.tmall|item\.jd\.com|amazon\..*\/dp\//.test(u)) {
      type = 'product';
      schema = extractProduct();
    }
    // Article / blog post
    else if (signals.hasArticle || /\/(blog|article|post|news)\//.test(path) || signals.metaType === 'article') {
      type = 'article';
      schema = extractArticle();
    }
    // Form page
    else if (signals.hasForm && document.querySelectorAll('form input, form select, form textarea').length > 3) {
      type = 'form';
      schema = extractFormFields();
    }
    // Video page
    else if (signals.hasVideo || /youtube\.com\/watch|bilibili\.com\/video|v\.qq\.com/.test(u)) {
      type = 'video';
      schema = extractVideo();
    }
    // Data table / dashboard
    else if (signals.hasTable) {
      type = 'table';
      schema = extractTable();
    }
    // Feed / list page
    else if (signals.hasFeed) {
      type = 'feed';
      schema = extractFeed();
    }
    // Homepage / landing
    else if (path === '/' || path === '') {
      type = 'homepage';
      schema = { title: signals.title, h1: signals.h1, siteName: signals.metaSite };
    }

    return { type, url: u, title: signals.title, schema };
  }

  function extractSearchResults() {
    const items = [];
    document.querySelectorAll('h3, [role="heading"][aria-level="3"], .result-title, .gs-title').forEach(h => {
      const a = h.closest('a') || h.querySelector('a');
      if (a && h.textContent.trim()) {
        items.push({ title: h.textContent.trim().slice(0, 200), url: a.href });
      }
    });
    return { resultCount: items.length, results: items.slice(0, 20) };
  }

  function extractProduct() {
    const price = document.querySelector('.price, [class*="price"], [data-price]')?.textContent?.trim();
    const name = document.querySelector('h1, .product-name, .product-title')?.textContent?.trim();
    const img = document.querySelector('.product-image img, [class*="gallery"] img')?.src;
    const desc = document.querySelector('.description, [class*="description"]')?.textContent?.trim()?.slice(0, 500);
    return { name, price, image: img, description: desc };
  }

  function extractArticle() {
    const title = document.querySelector('h1')?.textContent?.trim();
    const author = document.querySelector('[rel="author"], .author, [class*="author"]')?.textContent?.trim();
    const date = document.querySelector('time, [class*="date"], [class*="time"]')?.textContent?.trim();
    const content = document.querySelector('article, [role="article"], .post-content, .entry-content')?.textContent?.trim()?.slice(0, 2000);
    return { title, author, date, contentLength: content?.length || 0, preview: content?.slice(0, 500) };
  }

  function extractFormFields() {
    const fields = [];
    document.querySelectorAll('form input, form select, form textarea').forEach(el => {
      fields.push({
        tag: el.tagName.toLowerCase(),
        type: el.type || '',
        name: el.name || '',
        label: el.labels?.[0]?.textContent?.trim() || el.placeholder || el.getAttribute('aria-label') || '',
        required: el.required
      });
    });
    return { fieldCount: fields.length, fields: fields.slice(0, 30) };
  }

  function extractVideo() {
    const title = document.querySelector('h1, [class*="title"]')?.textContent?.trim();
    const v = document.querySelector('video');
    return {
      title,
      src: v?.src || v?.querySelector('source')?.src || '',
      duration: v?.duration,
      platform: /bilibili/.test(location.href) ? 'bilibili' : /youtube/.test(location.href) ? 'youtube' : 'unknown'
    };
  }

  function extractTable() {
    const headers = Array.from(document.querySelectorAll('table th, [role="columnheader"]')).map(h => h.textContent.trim());
    const rowCount = document.querySelectorAll('table tr, [role="row"]').length;
    return { headers, rowCount, columnCount: headers.length };
  }

  function extractFeed() {
    const items = [];
    document.querySelectorAll('[class*="card"], [class*="item"], [class*="post"]').forEach((el, i) => {
      if (i >= 20) return;
      const title = el.querySelector('h2, h3, h4, [class*="title"]')?.textContent?.trim();
      const link = el.querySelector('a')?.href;
      if (title) items.push({ title: title.slice(0, 150), url: link });
    });
    return { itemCount: items.length, items };
  }

  // ── Init ──
  startObserving();
  console.log('[Browser Sense] Content script loaded');
})();
