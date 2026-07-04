// options.js — Settings page logic for Chrome Explanator

const DEFAULT_CONFIG = {
  provider: 'openai',
  openai: { apiKey: '', model: 'gpt-4o-mini' },
  anthropic: { apiKey: '', model: 'claude-haiku-4-5' },
  language: 'auto',
};

function setKeyStatus(provider, { ok, message, pending } = {}) {
  const el = document.getElementById(`${provider}-key-status`);
  el.className = 'key-status' + (pending ? ' pending' : ok ? ' ok' : ' err');
  el.textContent = message || '';
}

async function testKey(provider) {
  const apiKey = document.getElementById(`${provider}-key`).value.trim();
  if (!apiKey) { setKeyStatus(provider, { ok: false, message: 'Enter an API key first' }); return; }

  const btn = document.getElementById(`${provider}-test-btn`);
  btn.disabled = true;
  setKeyStatus(provider, { pending: true, message: 'Testing…' });

  try {
    let response;
    if (provider === 'openai') {
      response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
    } else {
      response = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        signal: AbortSignal.timeout(10000),
      });
    }

    if (response.status === 401) {
      setKeyStatus(provider, { ok: false, message: '✗ Invalid API key' });
    } else if (response.status === 403) {
      setKeyStatus(provider, { ok: false, message: '✗ Access denied — check key permissions' });
    } else if (!response.ok) {
      setKeyStatus(provider, { ok: false, message: `✗ Error ${response.status}` });
    } else {
      setKeyStatus(provider, { ok: true, message: '✓ Valid' });
    }
  } catch (err) {
    const msg = (err.name === 'AbortError' || err.name === 'TimeoutError')
      ? '✗ Timed out'
      : '✗ Could not connect';
    setKeyStatus(provider, { ok: false, message: msg });
  } finally {
    btn.disabled = false;
  }
}

function populateModelSelect(provider, models, selectedModel) {
  const select = document.getElementById(`${provider}-model`);
  select.innerHTML = '';
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    select.appendChild(opt);
  }
  select.value = selectedModel;
  if (!select.value && models.length) select.value = models[0].id;
}

async function fetchModels(provider) {
  const apiKey = document.getElementById(`${provider}-key`).value.trim();
  if (!apiKey) { setKeyStatus(provider, { ok: false, message: 'Enter an API key to refresh models' }); return; }

  const btn = document.getElementById(`${provider}-refresh-btn`);
  const select = document.getElementById(`${provider}-model`);
  btn.disabled = true;
  btn.textContent = '…';

  try {
    let models = [];

    if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) { setKeyStatus(provider, { ok: false, message: `✗ Could not fetch models (${r.status})` }); return; }
      const data = await r.json();
      models = data.data
        .filter(m => (m.id.startsWith('gpt-') || /^o[1-9]/.test(m.id)) && !['instruct', 'audio', 'realtime'].some(x => m.id.includes(x)) && !/-\d{4}-\d{2}-\d{2}$/.test(m.id))
        .map(m => ({ id: m.id, label: m.id }))
        .sort((a, b) => b.id.localeCompare(a.id));
    } else {
      const r = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) { setKeyStatus(provider, { ok: false, message: `✗ Could not fetch models (${r.status})` }); return; }
      const data = await r.json();
      models = (data.data || [])
        .filter(m => m.id.startsWith('claude-') && !/-\d{8}$/.test(m.id))
        .map(m => ({ id: m.id, label: m.display_name || m.id }))
        .sort((a, b) => b.id.localeCompare(a.id));
    }

    if (!models.length) { setKeyStatus(provider, { ok: false, message: '✗ No models found' }); return; }

    const current = select.value;
    populateModelSelect(provider, models, current);
    await chrome.storage.local.set({ [`${provider}Models`]: models });

    setKeyStatus(provider, { ok: true, message: `✓ ${models.length} models loaded` });
  } catch (err) {
    const msg = (err.name === 'AbortError' || err.name === 'TimeoutError') ? '✗ Timed out' : '✗ Could not connect';
    setKeyStatus(provider, { ok: false, message: msg });
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Refresh';
  }
}

function renderKnownTerms(terms) {
  const list = document.getElementById('known-terms-list');
  const empty = document.getElementById('known-terms-empty');
  list.innerHTML = '';
  if (!terms.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  for (const term of terms) {
    const chip = document.createElement('div');
    chip.className = 'term-chip';
    const span = document.createElement('span');
    span.textContent = term;
    const btn = document.createElement('button');
    btn.className = 'term-remove';
    btn.textContent = '×';
    btn.dataset.term = term;
    chip.appendChild(span);
    chip.appendChild(btn);
    list.appendChild(chip);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const [config, { knownTerms = [] }, { openaiModels = null, anthropicModels = null }] = await Promise.all([
    chrome.storage.local.get(DEFAULT_CONFIG),
    chrome.storage.local.get({ knownTerms: [] }),
    chrome.storage.local.get({ openaiModels: null, anthropicModels: null }),
  ]);

  document.getElementById('provider').value = config.provider;
  document.getElementById('language').value = config.language || 'auto';
  document.getElementById('openai-key').value = config.openai.apiKey;
  document.getElementById('anthropic-key').value = config.anthropic.apiKey;

  if (openaiModels) {
    populateModelSelect('openai', openaiModels, config.openai.model);
  } else {
    document.getElementById('openai-model').value = config.openai.model;
  }

  if (anthropicModels) {
    populateModelSelect('anthropic', anthropicModels, config.anthropic.model);
  } else {
    document.getElementById('anthropic-model').value = config.anthropic.model;
  }

  renderKnownTerms(knownTerms);

  document.getElementById('known-terms-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.term-remove');
    if (!btn) return;
    const termToRemove = btn.dataset.term;
    const { knownTerms: current = [] } = await chrome.storage.local.get({ knownTerms: [] });
    const updated = current.filter(t => t !== termToRemove);
    await chrome.storage.local.set({ knownTerms: updated });
    renderKnownTerms(updated);
  });

  document.getElementById('openai-test-btn').addEventListener('click', () => testKey('openai'));
  document.getElementById('anthropic-test-btn').addEventListener('click', () => testKey('anthropic'));
  document.getElementById('openai-refresh-btn').addEventListener('click', () => fetchModels('openai'));
  document.getElementById('anthropic-refresh-btn').addEventListener('click', () => fetchModels('anthropic'));

  document.getElementById('save-btn').addEventListener('click', async () => {
    const newConfig = {
      provider: document.getElementById('provider').value,
      language: document.getElementById('language').value,
      openai: {
        apiKey: document.getElementById('openai-key').value.trim(),
        model: document.getElementById('openai-model').value,
      },
      anthropic: {
        apiKey: document.getElementById('anthropic-key').value.trim(),
        model: document.getElementById('anthropic-model').value,
      },
    };
    await chrome.storage.local.set(newConfig);
    const status = document.getElementById('status');
    status.textContent = 'Saved!';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});
