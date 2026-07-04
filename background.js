// background.js — Chrome Explanator service worker (MV3, ES module)

// T011: Default prompt fallback and system prompt state
const DEFAULT_PROMPT = `You are an assistant that explains complex text {language_instruction}.\n\nContext:\n---\n{context}\n---\n\nSelected fragment:\n---\n{selected_text}\n---\n\nRewrite the selected fragment {language_instruction}, simplifying it. Keep the rewritten text clean — no inline explanations. List every technical term, abbreviation, and company name separately.\n\n{known_terms}\n\nReturn ONLY valid JSON (no markdown, no code fences):\n{"rewritten":"simplified text","terms":[{"term":"exact term","explanation":"brief explanation"}]}`;

const LANGUAGE_INSTRUCTIONS = {
  auto: 'in the same language as the selected text',
  en: 'in plain English',
  uk: 'in plain Ukrainian',
  es: 'in plain Spanish',
  fr: 'in plain French',
  de: 'in plain German',
  pl: 'in plain Polish',
  pt: 'in plain Portuguese',
  zh: 'in plain Chinese (Simplified)',
  ja: 'in plain Japanese',
  ar: 'in plain Arabic',
  it: 'in plain Italian',
};

let systemPrompt = DEFAULT_PROMPT;

async function loadSystemPrompt() {
  try {
    const url = chrome.runtime.getURL('prompts/system-prompt.txt');
    const response = await fetch(url);
    if (!response.ok) { systemPrompt = DEFAULT_PROMPT; return; }
    const text = await response.text();
    systemPrompt = text.trim() || DEFAULT_PROMPT;
  } catch {
    systemPrompt = DEFAULT_PROMPT;
  }
}

// T015: Default AI config
const DEFAULT_CONFIG = {
  provider: 'openai',
  openai: { apiKey: '', model: 'gpt-4o-mini' },
  anthropic: { apiKey: '', model: 'claude-haiku-4-5' },
};

// T004: Register context menu on install to avoid duplicate registration on reload
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'explain-selection',
    title: 'Demystify with AI',
    contexts: ['selection'],
  });
  loadSystemPrompt();
});

self.addEventListener('activate', loadSystemPrompt);

// T004: Open options page when extension action icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// T006: Context menu click handler — send selected text to content script
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'explain-selection') return;
  if (!tab?.id) return;

  // On-demand injection: the context-menu click is a user gesture, which grants activeTab
  // access to this tab. This lets us drop the broad <all_urls> content script from the
  // manifest — no broad host permissions requested, faster store review.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
      files: ['content.js'],
    });
  } catch {
    return; // Can't inject here (e.g. chrome:// pages, the Web Store, or the PDF viewer)
  }

  chrome.tabs.sendMessage(
    tab.id,
    { type: 'SHOW_POPUP', selectedText: info.selectionText },
    { frameId: info.frameId }
  ).catch(() => {});
});

// T012: Render prompt template by substituting variables
function renderPrompt(template, selectedText, context, knownTerms = [], languageInstruction = LANGUAGE_INSTRUCTIONS.auto) {
  const knownLine = knownTerms.length
    ? `The user already knows these terms — do not explain them in detail: ${knownTerms.join(', ')}.`
    : '';
  return template
    .replace(/{language_instruction}/g, languageInstruction)
    .replace('{selected_text}', selectedText)
    .replace('{context}', context)
    .replace('{known_terms}', knownLine);
}

// T013: Call OpenAI chat completions API
async function callOpenAI(apiKey, model, systemPrompt, userMessage) {
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        // o-series and gpt-5+ require max_completion_tokens; older models use max_tokens
        // Reasoning models burn tokens on hidden thinking before producing output — needs a much higher cap
        [/^(o[1-9]|gpt-5)/.test(model) ? 'max_completion_tokens' : 'max_tokens']: 8192,
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw new Error('Request timed out — try again');
    }
    throw new Error('Could not reach AI — check your connection');
  }

  const data = await response.json();

  if (response.status === 401) throw new Error('Invalid API key — check Settings');
  if (response.status === 429) throw new Error(data.error.message);
  if (response.status === 400) throw new Error(data.error.message);
  if (!response.ok) throw new Error(data.error?.message || 'Could not reach AI — check your connection');

  return data.choices[0].message.content;
}

// T014: Call Anthropic messages API
async function callAnthropic(apiKey, model, systemPrompt, userMessage) {
  let response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw new Error('Request timed out — try again');
    }
    throw new Error('Could not reach AI — check your connection');
  }

  const data = await response.json();

  if (response.status === 401) throw new Error('Invalid API key — check Settings');
  if (response.status === 429) throw new Error(data.error.message);
  if (response.status === 400) throw new Error(data.error.message);
  if (!response.ok) throw new Error(data.error?.message || 'Could not reach AI — check your connection');

  return data.content.find(b => b.type === 'text')?.text;
}

// T015: Dispatcher — routes to the appropriate AI provider
async function callAI(config, prompt, selectedText, context, knownTerms = [], languageInstruction = LANGUAGE_INSTRUCTIONS.auto) {
  const renderedPrompt = renderPrompt(prompt, selectedText, context, knownTerms, languageInstruction);
  if (config.provider === 'openai') {
    if (!config.openai?.apiKey) throw new Error('Invalid API key — check Settings');
    return callOpenAI(config.openai.apiKey, config.openai.model, renderedPrompt, selectedText);
  } else {
    if (!config.anthropic?.apiKey) throw new Error('Invalid API key — check Settings');
    return callAnthropic(config.anthropic.apiKey, config.anthropic.model, renderedPrompt, selectedText);
  }
}

// T016: Message listener — handles EXPLAIN requests from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'EXPLAIN') {
    (async () => {
      try {
        const [config, { knownTerms = [] }, { language = 'auto' }] = await Promise.all([
          chrome.storage.local.get(DEFAULT_CONFIG),
          chrome.storage.local.get({ knownTerms: [] }),
          chrome.storage.local.get({ language: 'auto' }),
        ]);
        await loadSystemPrompt(); // ensure prompt is loaded
        const langInstruction = LANGUAGE_INSTRUCTIONS[language] || LANGUAGE_INSTRUCTIONS.auto;
        const result = await callAI(config, systemPrompt, msg.selectedText, msg.context, knownTerms, langInstruction);
        console.log('[CE] AI raw result:', JSON.stringify(result));
        sendResponse({ result });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true; // keep channel open for async sendResponse
  }
});
