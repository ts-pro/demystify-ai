// content.js — Chrome Explanator content script

// T007: Extract surrounding context from the page relative to the selection anchor
function extractContext(anchorNode) {
  // anchorNode from getSelection() is a Text node — closest() only exists on Element
  const anchor = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement;
  // IMPORTANT: X.com selector must come BEFORE generic 'article'
  const selectors = [
    'article[data-testid="tweet"]',
    'article',
    'main',
  ];
  for (const sel of selectors) {
    const el = anchor?.closest(sel) ?? document.querySelector(sel);
    if (el) return el.innerText.slice(0, 8000);
  }
  // Fallback: largest div by text length
  const divs = [...document.querySelectorAll('div')];
  const largest = divs.sort((a, b) => b.innerText.length - a.innerText.length)[0];
  if (largest && largest.innerText.length > 200) return largest.innerText.slice(0, 8000);
  // Last resort
  return document.body.innerText.slice(0, 3000);
}

// T017: Create Shadow DOM host for the popup (called once at module load)
function createPopupHost() {
  const host = document.createElement('div');
  host.id = 'chrome-explanator-host';
  host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL('content/popup.css');
  // FOUC prevention: keep popup invisible until CSS loads
  link.onload = () => { container.style.visibility = 'visible'; };
  shadow.appendChild(link);
  const container = document.createElement('div');
  container.id = 'explanator-popup';
  container.style.cssText = 'pointer-events:auto;visibility:hidden;display:none;';
  shadow.appendChild(container);
  const tooltip = document.createElement('div');
  tooltip.id = 'explanator-tooltip';
  tooltip.style.display = 'none';
  shadow.appendChild(tooltip);
  return { shadow, container, tooltip };
}
const { container, tooltip } = createPopupHost();

// T019: Position popup near the selection rectangle, clamped to viewport
function positionPopup(container, rect) {
  const MARGIN = 8;

  function clamp() {
    const h = container.offsetHeight || 220;
    const w = container.offsetWidth || 360;
    let top = rect.bottom + MARGIN;
    if (top + h > window.innerHeight - MARGIN) top = rect.top - h - MARGIN;
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - h - MARGIN));
    const left = Math.max(MARGIN, Math.min(rect.left, window.innerWidth - w - MARGIN));
    container.style.top = `${top}px`;
    container.style.left = `${left}px`;
  }

  clamp();
  requestAnimationFrame(clamp); // re-clamp after browser has measured actual height
}

// T020: Popup state helpers
let isDragging = false;
let activeTermSpan = null;

function createDragHandle() {
  const handle = document.createElement('div');
  handle.className = 'explanator-drag';
  handle.title = 'Drag to move';

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    const startX = e.clientX;
    const startY = e.clientY;
    const startTop = parseInt(container.style.top) || 0;
    const startLeft = parseInt(container.style.left) || 0;

    const onMove = (ev) => {
      container.style.top = `${startTop + ev.clientY - startY}px`;
      container.style.left = `${startLeft + ev.clientX - startX}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setTimeout(() => { isDragging = false; }, 0);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  return handle;
}

function showTermTooltip(span) {
  activeTermSpan = span;
  tooltip.textContent = span.dataset.explanation;
  tooltip.style.display = 'block';
  const MARGIN = 6;
  requestAnimationFrame(() => {
    const th = tooltip.offsetHeight;
    const tw = tooltip.offsetWidth;
    const rect = span.getBoundingClientRect();
    let top = rect.top - th - MARGIN;
    if (top < MARGIN) top = rect.bottom + MARGIN;
    let left = rect.left;
    if (left + tw > window.innerWidth - MARGIN) left = window.innerWidth - tw - MARGIN;
    tooltip.style.top = `${Math.max(MARGIN, top)}px`;
    tooltip.style.left = `${Math.max(MARGIN, left)}px`;
  });
}

function hideTermTooltip() {
  activeTermSpan = null;
  tooltip.style.display = 'none';
}

function renderAnnotatedText(parent, rewritten, terms) {
  if (!terms.length) {
    parent.appendChild(document.createTextNode(rewritten));
    return;
  }

  const annotations = [];
  for (const t of terms) {
    const escaped = t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    let match;
    while ((match = regex.exec(rewritten)) !== null) {
      annotations.push({ start: match.index, end: match.index + match[0].length, matchedText: match[0], explanation: t.explanation });
    }
  }

  annotations.sort((a, b) => a.start - b.start);
  const filtered = [];
  let cursor = 0;
  for (const ann of annotations) {
    if (ann.start >= cursor) {
      filtered.push(ann);
      cursor = ann.end;
    }
  }

  let pos = 0;
  for (const ann of filtered) {
    if (ann.start > pos) parent.appendChild(document.createTextNode(rewritten.slice(pos, ann.start)));
    const span = document.createElement('span');
    span.className = 'explanator-term';
    span.textContent = ann.matchedText;
    span.dataset.explanation = ann.explanation;
    span.addEventListener('mouseenter', () => showTermTooltip(span));
    span.addEventListener('mouseleave', hideTermTooltip);
    span.addEventListener('click', (e) => {
      e.stopPropagation();
      if (activeTermSpan === span && tooltip.style.display !== 'none') {
        hideTermTooltip();
      } else {
        showTermTooltip(span);
      }
    });
    parent.appendChild(span);
    pos = ann.end;
  }
  if (pos < rewritten.length) parent.appendChild(document.createTextNode(rewritten.slice(pos)));
}

// Parses **bold** markers from AI response into text nodes and <b> elements (no innerHTML / XSS risk)
function renderBoldText(parent, text) {
  const parts = text.split(/\*\*([^*]+)\*\*/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1) {
      const b = document.createElement('b');
      b.textContent = part;
      parent.appendChild(b);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  });
}

function addCloseButton(container) {
  const btn = document.createElement('button');
  btn.className = 'explanator-close';
  btn.textContent = '×';
  btn.onclick = hidePopup;
  container.appendChild(btn);
}

function hidePopup() {
  container.style.display = 'none';
  container.className = '';
  container.innerHTML = '';
  hideTermTooltip();
  document.removeEventListener('click', onOutsideClick);
}

function onOutsideClick(e) {
  if (isDragging) return;
  const hostEl = document.getElementById('chrome-explanator-host');
  if (hostEl && !hostEl.contains(e.target)) hidePopup();
}

function showLoading(rect) {
  container.style.display = 'flex';
  container.className = 'loading';
  container.innerHTML = '<div class="explanator-spinner"></div><span>Thinking…</span>';
  positionPopup(container, rect);
  document.addEventListener('click', onOutsideClick);
}

function showResult(text, rect) {
  container.style.display = 'flex';
  container.className = '';
  container.innerHTML = '';
  addCloseButton(container);

  const body = document.createElement('div');
  body.className = 'explanator-body';
  const textDiv = document.createElement('div');
  textDiv.className = 'explanator-text';

  let parsed = null;
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const candidate = JSON.parse(cleaned);
    if (candidate?.rewritten) parsed = candidate;
  } catch { /* fall through to plain text */ }

  if (parsed) {
    renderAnnotatedText(textDiv, parsed.rewritten, parsed.terms || []);
  } else {
    renderBoldText(textDiv, text);
  }

  body.appendChild(textDiv);
  container.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'explanator-footer';
  footer.appendChild(createDragHandle());
  const markBtn = document.createElement('button');
  markBtn.className = 'explanator-mark-btn';
  markBtn.textContent = 'Mark selected as known';
  markBtn.addEventListener('click', async () => {
    const term = window.getSelection().toString().trim();
    if (!term) return;
    const { knownTerms = [] } = await chrome.storage.local.get({ knownTerms: [] });
    if (!knownTerms.includes(term)) {
      await chrome.storage.local.set({ knownTerms: [...knownTerms, term] });
    }
    markBtn.textContent = `✓ «${term}» added`;
    setTimeout(() => { markBtn.textContent = 'Mark selected as known'; }, 2000);
  });
  footer.appendChild(markBtn);
  container.appendChild(footer);
  positionPopup(container, rect);
}

function showError(message, rect) {
  container.style.display = 'flex';
  container.className = 'error';
  container.innerHTML = '';
  addCloseButton(container);

  const body = document.createElement('div');
  body.className = 'explanator-body';
  const textDiv = document.createElement('div');
  textDiv.className = 'explanator-text';
  textDiv.textContent = message;
  body.appendChild(textDiv);
  container.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'explanator-footer';
  footer.appendChild(createDragHandle());
  container.appendChild(footer);

  if (rect) positionPopup(container, rect);
}

function showToast(message) {
  container.style.display = 'block';
  container.className = 'toast';
  container.style.top = '';
  container.style.left = '';
  container.innerHTML = '';
  const textDiv = document.createElement('div');
  textDiv.className = 'explanator-text';
  textDiv.textContent = message;
  container.appendChild(textDiv);
  setTimeout(hidePopup, 2500);
}

// T021: Wire popup into onMessage handler
// T009: SHOW_POPUP handler — reads full selection, extracts context, applies truncation, sends EXPLAIN
let savedRect = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'SHOW_POPUP') return;

  hidePopup(); // clean up any previous state before starting a new request

  const selection = window.getSelection();
  const fullText = selection?.toString() || msg.selectedText;
  savedRect = selection?.rangeCount > 0
    ? selection.getRangeAt(0).getBoundingClientRect()
    : null;

  if (!fullText.trim()) return;

  const anchorNode = selection?.anchorNode;
  let context = extractContext(anchorNode);

  // T008: Combined truncation logic
  if (fullText.length > 2000) {
    context = fullText;
  } else if (fullText.length + context.length > 8000) {
    context = context.slice(0, 8000 - fullText.length);
  }

  showLoading(savedRect);

  chrome.runtime.sendMessage({ type: 'EXPLAIN', selectedText: fullText, context })
    .then(response => {
      console.log('[CE] content received response:', JSON.stringify(response));
      if (response?.error) {
        showError(response.error, savedRect);
      } else if (response?.result) {
        showResult(response.result, savedRect);
      } else {
        showError('No response from AI — try again', savedRect);
      }
    })
    .catch(() => {
      showError('Could not reach AI — check your connection', savedRect);
    });
});
