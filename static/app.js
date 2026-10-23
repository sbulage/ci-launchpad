/* CI Launchpad — client application */

let WORKFLOWS = [];
let currentRepo = '';
const state = { selected: new Set(), ghUser: null, userOverride: '' };
let _lastActivity = Date.now();
let _sessionLocked = false;
let _cooldownUntil = 0;
let _autoRefreshTimer = null;
const _clusterVersions = { k3s: [], rke2: [] };
const DISTRO_LABELS = { k3s: 'K3s', rke2: 'RKE2' };
const DISTRO_EXAMPLES = { k3s: 'v1.36.1+k3s1', rke2: 'v1.36.5+rke2r1' };

// ── Theme ─────────────────────────────────────────

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('ci-lp-theme', t);
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === t)
  );
}

function initTheme() {
  const saved = localStorage.getItem('ci-lp-theme') || 'dark';
  setTheme(saved);
}

// ── User ──────────────────────────────────────────

async function detectUser() {
  const section = document.getElementById('user-section');
  const ghBadge = document.getElementById('gh-status');
  try {
    const res = await fetch('/api/gh-user');
    const data = await res.json();
    if (data.login) {
      state.ghUser = data;
      const savedOverride = localStorage.getItem('ci-lp-user-override') || '';
      state.userOverride = savedOverride;
      const displayName = savedOverride || data.name || data.login;
      const avatarHtml = data.avatar_url
        ? `<img class="user-avatar" src="${data.avatar_url}" alt="${data.login}">`
        : `<div class="user-avatar-placeholder">${displayName.charAt(0).toUpperCase()}</div>`;
      section.innerHTML = `
        ${avatarHtml}
        <div>
          <input class="user-name-edit" id="user-name-field" value="${displayName}"
            title="Edit display name (gh: @${data.login})" oninput="onUserNameChange(this.value)">
          <div class="user-login">@${data.login}</div>
        </div>
        <span class="gh-status ok">authenticated</span>`;
    } else {
      ghBadge.textContent = 'not authenticated';
      ghBadge.className = 'gh-status err';
    }
  } catch (e) {
    ghBadge.textContent = 'gh error';
    ghBadge.className = 'gh-status err';
  }
}

function onUserNameChange(val) {
  state.userOverride = val.trim();
  localStorage.setItem('ci-lp-user-override', state.userOverride);
}

function getUser() {
  if (state.userOverride) return state.userOverride;
  if (state.ghUser) return state.ghUser.name || state.ghUser.login;
  return '';
}

function getBranch() {
  return document.getElementById('branch-input').value.trim() || 'main';
}

// ── Auto-size inputs ─────────────────────────────

function autoSizeInput(el) {
  const min = parseInt(el.getAttribute('data-min-ch') || '12', 10);
  // + padding and border, which `ch` alone doesn't cover under border-box
  el.style.width = `calc(${Math.max(min, el.value.length + 2)}ch + 26px)`;
}

function initAutoSize() {
  document.querySelectorAll('[data-min-ch]').forEach(el => autoSizeInput(el));
}

// ── Repo ──────────────────────────────────────────

function initRepo() {
  const saved = localStorage.getItem('ci-lp-repo') || window.DEFAULT_REPO;
  document.getElementById('repo-input').value = saved;
  const input = document.getElementById('repo-input');
  input.addEventListener('keydown', e => { if (e.key === 'Enter') loadRepo(); });

  const savedBranch = localStorage.getItem('ci-lp-branch') || 'main';
  document.getElementById('branch-input').value = savedBranch;

  initAutoSize();

  const cached = localStorage.getItem('ci-lp-workflows');
  const cachedRepo = localStorage.getItem('ci-lp-workflows-repo');
  if (cached && cachedRepo === saved) {
    currentRepo = saved;
    try {
      const parsed = JSON.parse(cached);
      WORKFLOWS = parsed.workflows;
      finishLoad(parsed);
      return;
    } catch (e) {}
  }
  loadRepo();
}

async function loadRepo() {
  const repo = document.getElementById('repo-input').value.trim();
  if (!repo) { toast('Enter a repository (owner/repo)', 'error'); return; }
  localStorage.setItem('ci-lp-repo', repo);
  currentRepo = repo;

  const grid = document.getElementById('wf-grid');
  grid.innerHTML = '<div class="empty-state"><span class="spinner"></span> Loading workflows...</div>';

  try {
    const res = await fetch('/api/load-workflows?repo=' + encodeURIComponent(repo));
    const data = await res.json();
    if (data.error) {
      grid.innerHTML = `<div class="empty-state" style="color:var(--red)">${data.error}</div>`;
      return;
    }

    if (data.known) {
      WORKFLOWS = data.workflows;
      finishLoad(data);
    } else {
      showWorkflowPicker(data.workflows, repo);
    }
  } catch (e) {
    grid.innerHTML = `<div class="empty-state" style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

async function addMoreWorkflows() {
  const repo = currentRepo;
  if (!repo) return;
  const grid = document.getElementById('wf-grid');
  grid.innerHTML = '<div class="empty-state"><span class="spinner"></span> Fetching workflow list...</div>';
  try {
    const res = await fetch('/api/load-workflows?repo=' + encodeURIComponent(repo));
    const data = await res.json();
    if (data.error) { grid.innerHTML = `<div class="empty-state" style="color:var(--red)">${data.error}</div>`; return; }
    showWorkflowPicker(data.workflows, repo, true);
  } catch (e) {
    grid.innerHTML = `<div class="empty-state" style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

function showWorkflowPicker(wfs, repo, addMode) {
  const grid = document.getElementById('wf-grid');
  const loadedFiles = new Set(WORKFLOWS.map(w => w.file));
  const candidates = wfs.filter(w => w.path);
  const items = candidates.map((w, i) => {
    const already = addMode && loadedFiles.has(w.file);
    return `
    <label class="picker-item${already ? ' picker-loaded' : ''}">
      <input type="checkbox" value="${i}" ${already ? 'disabled' : 'checked'}>
      <span class="picker-name">${w.label}</span>
      ${already ? '<span class="picker-badge">loaded</span>' : ''}
      <span class="picker-file">${w.file}</span>
    </label>`;
  }).join('');

  const title = addMode ? 'Add more workflows' : 'Select workflows to load';
  const hint = addMode
    ? `${candidates.length} in ${repo} — already loaded ones are greyed out`
    : `${candidates.length} found in ${repo} — pick which to fetch inputs for`;

  grid.innerHTML = `
    <div class="picker-panel">
      <div class="picker-header">
        <h3>${title}</h3>
        <span class="picker-hint">${hint}</span>
      </div>
      <div class="picker-list">${items}</div>
      <div class="picker-actions">
        <button class="btn btn-primary" onclick="confirmPicker(false, ${!!addMode})">Load Selected</button>
        ${addMode ? '<button class="btn btn-outline" onclick="cancelPicker()">Cancel</button>' : '<button class="btn btn-outline" onclick="confirmPicker(true)">Load All</button>'}
      </div>
    </div>`;

  grid._pickerWfs = candidates;
  grid._pickerAllWfs = wfs;
  grid._pickerRepo = repo;
}

async function confirmPicker(all, appendMode) {
  const grid = document.getElementById('wf-grid');
  const repo = grid._pickerRepo;

  let chosen;
  if (all) {
    chosen = grid._pickerWfs;
  } else {
    const pickerWfs = grid._pickerWfs;
    const checked = new Set();
    grid.querySelectorAll('.picker-item input:checked:not(:disabled)').forEach(cb => checked.add(parseInt(cb.value)));
    chosen = pickerWfs.filter((_, i) => checked.has(i));
  }

  if (!chosen.length) { toast('Select at least one workflow', 'error'); return; }

  grid.innerHTML = `<div class="empty-state"><span class="spinner"></span> Fetching inputs for ${chosen.length} workflow(s)...</div>`;

  const enriched = [];
  for (const wf of chosen) {
    if (wf.path) {
      try {
        const r = await fetch(`/api/enrich-workflow?repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(wf.path)}`);
        const d = await r.json();
        enriched.push({ ...wf, dispatch_inputs: d.dispatch_inputs || [] });
      } catch (e) {
        enriched.push({ ...wf, dispatch_inputs: [] });
      }
    } else {
      enriched.push(wf);
    }
  }

  if (appendMode) {
    WORKFLOWS = WORKFLOWS.concat(enriched);
  } else {
    WORKFLOWS = enriched;
  }
  finishLoad({ known: false });
}

function cancelPicker() {
  renderCards();
}

function finishLoad(data) {
  state.selected.clear();
  renderCards();
  document.getElementById('stats-row').style.display = 'flex';
  document.getElementById('actions-bar').style.display = 'flex';
  document.getElementById('presets-bar').style.display = 'flex';
  document.getElementById('stat-wf-count').textContent = WORKFLOWS.length;
  document.getElementById('stat-repo-type').textContent = data.known ? 'Known' : 'Discovered';
  document.getElementById('btn-add-wf').style.display = data.known ? 'none' : 'flex';
  updateSelection();
  loadRunStats();
  refreshPresetList();

  localStorage.setItem('ci-lp-workflows-repo', currentRepo);
  localStorage.setItem('ci-lp-workflows', JSON.stringify({ workflows: WORKFLOWS, known: !!data.known }));
}

async function loadRunStats() {
  try {
    const res = await fetch('/api/runs?repo=' + encodeURIComponent(currentRepo));
    const data = await res.json();
    if (data.runs) {
      document.getElementById('stat-success').textContent =
        data.runs.filter(r => r.conclusion === 'success').length;
      document.getElementById('stat-fail').textContent =
        data.runs.filter(r => r.conclusion === 'failure').length;
    }
  } catch (e) {}
}

// ── Branches ─────────────────────────────────────

async function loadBranches() {
  const repo = document.getElementById('repo-input').value.trim();
  if (!repo) return;
  try {
    const res = await fetch('/api/branches?repo=' + encodeURIComponent(repo));
    const data = await res.json();
    const dl = document.getElementById('branch-list');
    dl.innerHTML = '';
    for (const b of data.branches || []) {
      const opt = document.createElement('option');
      opt.value = b;
      dl.appendChild(opt);
    }
    toast(`Loaded ${(data.branches || []).length} branches`, 'info');
  } catch (e) {
    toast('Failed to load branches', 'error');
  }
}

document.getElementById('branch-input').addEventListener('change', function() {
  localStorage.setItem('ci-lp-branch', this.value.trim());
  autoSizeInput(this);
});

// ── Cluster versions (K3s / RKE2) ────────────────

async function loadClusterVersions() {
  await Promise.all(Object.keys(_clusterVersions).map(async distro => {
    try {
      const res = await fetch('/api/cluster-versions?distro=' + distro);
      const data = await res.json();
      _clusterVersions[distro] = data.versions || [];
    } catch (e) {}
  }));
  refreshClusterDropdowns();
}

// Guess the distro of a version input from its value, then its name/description
function detectDistro(value, hint) {
  if (/\+rke2r\d/.test(value || '')) return 'rke2';
  if (/\+k3s\d/.test(value || '')) return 'k3s';
  if (/rke2/i.test(hint || '')) return 'rke2';
  if (/k3s/i.test(hint || '')) return 'k3s';
  return null;
}

function refreshClusterDropdowns() {
  document.querySelectorAll('select.cluster-version').forEach(sel => {
    sel.innerHTML = clusterOptionsHtml(sel.dataset.distro, sel.value, 'allowEmpty' in sel.dataset);
  });
}

// allowEmpty: input had no default, so offer sending nothing (workflow decides)
function clusterOptionsHtml(distro, currentVal, allowEmpty) {
  const versions = _clusterVersions[distro] || [];
  const empty = allowEmpty ? `<option value="" ${currentVal ? '' : 'selected'}>(workflow default)</option>` : '';
  if (!versions.length) return empty + (currentVal || !allowEmpty ? `<option value="${currentVal || ''}">${currentVal || '—'}</option>` : '');
  const opts = versions.map(v =>
    `<option value="${v}" ${v === currentVal ? 'selected' : ''}>${v}</option>`
  );
  if (currentVal && !versions.includes(currentVal)) {
    opts.unshift(`<option value="${currentVal}" selected>${currentVal} (custom)</option>`);
  }
  opts.push('<option value="__custom__">Custom...</option>');
  return empty + opts.join('');
}

function clusterSelectHtml(distro, currentVal, attr, allowEmpty) {
  return `<select class="cluster-version" data-distro="${distro}" ${allowEmpty ? 'data-allow-empty' : ''} ${attr} onchange="onClusterVersionChange(this)">${clusterOptionsHtml(distro, currentVal, allowEmpty)}</select>`;
}

function onClusterVersionChange(sel) {
  if (sel.value === '__custom__') {
    const distro = sel.dataset.distro;
    const val = prompt(`Enter custom ${DISTRO_LABELS[distro]} version (e.g. ${DISTRO_EXAMPLES[distro]}):`);
    if (val) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = val + ' (custom)'; opt.selected = true;
      sel.insertBefore(opt, sel.firstChild);
    } else {
      sel.selectedIndex = 0;
    }
  }
}

function distroToggleHtml(active) {
  return `<div class="distro-toggle">${Object.keys(DISTRO_LABELS).map(d =>
    `<button type="button" class="distro-btn ${d === active ? 'active' : ''}" data-distro="${d}" onclick="setDistro(this)">${DISTRO_LABELS[d]}</button>`
  ).join('')}</div>`;
}

// Switch a version dropdown to another distro, keeping the selection if it already matches
function setDistro(btn, value) {
  const row = btn.closest('.param-row');
  const sel = row.querySelector('select.cluster-version');
  const distro = btn.dataset.distro;
  row.querySelectorAll('.distro-btn').forEach(b => b.classList.toggle('active', b === btn));
  if (sel.dataset.distro === distro && value === undefined) return;
  const allowEmpty = 'allowEmpty' in sel.dataset;
  sel.dataset.distro = distro;
  sel.innerHTML = clusterOptionsHtml(distro, value || '', allowEmpty);
  // a manual switch picks the newest version of the new distro
  if (value === undefined) sel.selectedIndex = allowEmpty && sel.options.length > 1 ? 1 : 0;
}

function setClusterSelectValue(sel, value) {
  const btn = sel.closest('.param-row').querySelector(`.distro-btn[data-distro="${detectDistro(value) || sel.dataset.distro}"]`);
  if (btn) setDistro(btn, value);
  else sel.innerHTML = clusterOptionsHtml(sel.dataset.distro, value, 'allowEmpty' in sel.dataset);
}

// ── Tabs ──────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'runs') loadRuns();
  if (name === 'history') loadHistory();

  if (name !== 'runs') stopAutoRefresh();
}

// ── Cards ─────────────────────────────────────────

function renderCards() {
  const grid = document.getElementById('wf-grid');
  grid.innerHTML = '';
  WORKFLOWS.forEach((wf, i) => {
    const card = document.createElement('div');
    card.className = 'wf-card';
    card.dataset.idx = i;

    if (wf.discovered) {
      card.innerHTML = renderDiscoveredCard(wf, i);
    } else {
      card.innerHTML = renderKnownCard(wf, i);
    }

    grid.appendChild(card);
  });
}

function renderKnownCard(wf, i) {
  const activeTags = (wf.tags || '').split(/\s+/).filter(Boolean);
  const availTags = wf.available_tags || [];

  let extrasHtml = '';
  for (const [k, v] of Object.entries(wf.extras || {})) {
    extrasHtml += `
      <div class="param-row">
        <label>${k.replace(/_/g, ' ')}</label>
        <input data-extra="${k}" value="${v}">
      </div>`;
  }

  const runnerOpts = window.RUNNER_TEMPLATES.map(t =>
    `<option value="${t.value}" ${t.value === (wf.runner_template || '') ? 'selected' : ''}>${t.label}</option>`
  ).join('');

  const tagsHtml = availTags.map(t =>
    `<span class="tag-pill ${activeTags.includes(t) ? 'active' : ''}" onclick="toggleTag(this)">${t}</span>`
  ).join('');

  const qaseReport = wf.qase_report !== undefined ? wf.qase_report : true;
  const qaseComplete = wf.qase_complete_run !== undefined ? wf.qase_complete_run : true;
  const qaseRunId = wf.qase_run_id || '';

  const rke2Html = wf.rke2_choices ? `
    <div class="param-row">
      <label>RKE2</label>
      <select data-field="${wf.rke2_field}">${wf.rke2_choices.map(v =>
        `<option value="${v}" ${v === wf.rke2_version ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </div>` : '';

  return `
    <div class="header" onclick="toggleCard(${i})">
      <div>
        <div class="name">${wf.label}</div>
        <div class="file">${wf.file}</div>
      </div>
      <div class="check-box"></div>
    </div>
    <div class="param-row">
      <label>Rancher</label>
      <input data-field="rancher_version" value="${wf.rancher_version || ''}" placeholder="e.g. head/2.16">
    </div>
    <div class="param-row">
      <label>K3s</label>
      ${clusterSelectHtml('k3s', wf.k3s_version || '', 'data-field="upstream_cluster_version"')}
    </div>
    ${rke2Html}
    <div class="param-row">
      <label>Runner</label>
      <div class="runner-tooltip" data-tooltip="${wf.runner_template || 'default'}" style="flex:1;display:flex">
        <select data-field="runner_template" style="flex:1" onchange="updateRunnerTooltip(this)">${runnerOpts}</select>
      </div>
    </div>
    <div class="param-row">
      <label>Destroy</label>
      <select data-field="destroy_runner">
        <option value="true" selected>Yes</option>
        <option value="false">No</option>
      </select>
    </div>
    <div class="param-row">
      <label>Tags</label>
      <div class="tag-pills" data-card="${i}">${tagsHtml}</div>
    </div>
    ${extrasHtml}
    <div class="qase-section">
      <div class="qase-row">
        <div class="qase-toggle-group">
          <label>Report</label>
          <label class="toggle-switch">
            <input type="checkbox" data-qase="qase_report" ${qaseReport ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="qase-toggle-group">
          <label>Complete</label>
          <label class="toggle-switch">
            <input type="checkbox" data-qase="qase_complete_run" ${qaseComplete ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <input class="qase-input" data-qase="qase_run_id" value="${qaseRunId}"
          placeholder="Run ID" title="QASE run ID — leave empty to create a new run">
      </div>
    </div>`;
}

function renderDiscoveredCard(wf, i) {
  const inputs = wf.dispatch_inputs || [];

  if (!inputs.length) {
    return `
      <div class="header" onclick="toggleCard(${i})">
        <div>
          <div class="name">${wf.label}</div>
          <div class="file">${wf.file}</div>
        </div>
        <div class="check-box"></div>
      </div>
      <div style="color:var(--dimmer);font-size:0.82rem;padding:4px 0">
        No dispatch inputs (may not be manually triggerable)
      </div>`;
  }

  let fieldsHtml = '';
  for (const inp of inputs) {
    const lbl = inp.name.replace(/_/g, ' ');
    const desc = inp.description ? ` title="${inp.description.replace(/"/g, '&quot;')}"` : '';

    if (inp.type === 'boolean') {
      const checked = inp.default === 'true' ? 'checked' : '';
      fieldsHtml += `
        <div class="param-row"${desc}>
          <label>${lbl}</label>
          <div style="flex:1;display:flex;align-items:center;gap:8px">
            <label class="toggle-switch">
              <input type="checkbox" data-dispatch="${inp.name}" ${checked}>
              <span class="toggle-slider"></span>
            </label>
            <span style="color:var(--dimmer);font-size:0.72rem">${inp.default === 'true' ? 'on' : 'off'} by default</span>
          </div>
        </div>`;
    } else if (inp.options && inp.options.length) {
      // choice input: GitHub rejects values outside the declared options
      fieldsHtml += `
        <div class="param-row"${desc}>
          <label>${lbl}</label>
          <select data-dispatch="${inp.name}" title="${inp.default || ''}" onchange="this.title = this.value">${inp.options.map(o =>
            `<option value="${o}" ${o === inp.default ? 'selected' : ''}>${o}</option>`).join('')}</select>
        </div>`;
    } else if (detectDistro(inp.default, inp.name + ' ' + inp.description)) {
      const distro = detectDistro(inp.default, inp.name + ' ' + inp.description);
      fieldsHtml += `
        <div class="param-row"${desc}>
          <label>${lbl}</label>
          <div class="cluster-field">
            ${distroToggleHtml(distro)}
            ${clusterSelectHtml(distro, inp.default || '', `data-dispatch="${inp.name}"`, !inp.default)}
          </div>
        </div>`;
    } else {
      fieldsHtml += `
        <div class="param-row"${desc}>
          <label>${lbl}</label>
          <input data-dispatch="${inp.name}" value="${inp.default || ''}"
            placeholder="${inp.description ? inp.description.substring(0, 50) : ''}">
        </div>`;
    }
  }

  return `
    <div class="header" onclick="toggleCard(${i})">
      <div>
        <div class="name">${wf.label}</div>
        <div class="file">${wf.file}</div>
      </div>
      <div class="check-box"></div>
    </div>
    ${fieldsHtml}`;
}

function updateRunnerTooltip(select) {
  const wrapper = select.closest('.runner-tooltip');
  if (wrapper) wrapper.dataset.tooltip = select.value;
}

function addCustomTag(cardIdx, btn) {
  const tag = prompt('Enter tag name (e.g. @my-tests):');
  if (!tag) return;
  const normalized = tag.startsWith('@') ? tag : '@' + tag;
  const pill = document.createElement('span');
  pill.className = 'tag-pill active';
  pill.textContent = normalized;
  pill.onclick = function() { toggleTag(this); };
  btn.parentNode.insertBefore(pill, btn);
}

function toggleCard(idx) {
  if (state.selected.has(idx)) state.selected.delete(idx);
  else state.selected.add(idx);
  updateSelection();
}
function selectAll() { WORKFLOWS.forEach((_, i) => state.selected.add(i)); updateSelection(); }
function clearAll()  { state.selected.clear(); updateSelection(); }

function updateSelection() {
  document.querySelectorAll('.wf-card').forEach(c => {
    c.classList.toggle('selected', state.selected.has(parseInt(c.dataset.idx)));
  });
  const n = state.selected.size;
  document.getElementById('sel-count').textContent = n + ' selected';
  document.getElementById('stat-selected').textContent = n;
  const btn = document.getElementById('trigger-btn');
  btn.disabled = n === 0;
  btn.classList.toggle('has-selection', n > 0);
}

function toggleTag(el) { el.classList.toggle('active'); }

function getCardParams(card) {
  const params = {};

  const dispatchEls = card.querySelectorAll('[data-dispatch]');
  if (dispatchEls.length) {
    dispatchEls.forEach(el => {
      const key = el.dataset.dispatch;
      if (el.type === 'checkbox') params[key] = el.checked ? 'true' : 'false';
      else params[key] = el.value;
    });
    return params;
  }

  card.querySelectorAll('[data-field]').forEach(el => { params[el.dataset.field] = el.value; });

  const tags = [];
  card.querySelectorAll('.tag-pill.active').forEach(el => tags.push(el.textContent));
  params.grep_test_by_tag = tags.join(' ');

  card.querySelectorAll('[data-extra]').forEach(el => { params[el.dataset.extra] = el.value; });

  card.querySelectorAll('[data-qase]').forEach(el => {
    const key = el.dataset.qase;
    if (el.type === 'checkbox') params[key] = el.checked ? 'true' : 'false';
    else if (el.value) params[key] = el.value;
  });

  return params;
}

// ── Settings panel ──────────────────────────────

function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  const backdrop = document.getElementById('settings-backdrop');
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  backdrop.classList.toggle('open', !isOpen);
}

function onIdleSliderChange(val) {
  val = parseInt(val, 10);
  setIdleTimeout(val);
}

function onCooldownSliderChange(val) {
  val = parseInt(val, 10);
  setCooldown(val);
}

function formatCooldown(val) {
  if (val >= 60) return (val / 60) + 'm';
  return val + 's';
}

function initSettings() {
  const idleVal = getIdleTimeout();
  const slider = document.getElementById('idle-slider');
  if (slider) slider.value = idleVal;
  const idleLabel = document.getElementById('idle-slider-value');
  if (idleLabel) idleLabel.textContent = idleVal === 0 ? 'Off' : idleVal + 'm';
  const lockSel = document.getElementById('idle-timeout-select');
  if (lockSel) lockSel.value = String(idleVal);
}

// ── Security: idle lock ──────────────────────────

function getIdleTimeout() {
  return parseInt(localStorage.getItem('ci-lp-idle-timeout') || '15', 10);
}

function setIdleTimeout(min) {
  min = parseInt(min, 10);
  localStorage.setItem('ci-lp-idle-timeout', String(min));
  const slider = document.getElementById('idle-slider');
  if (slider) slider.value = min;
  const label = document.getElementById('idle-slider-value');
  if (label) label.textContent = min === 0 ? 'Off' : min + 'm';
  const lockSel = document.getElementById('idle-timeout-select');
  if (lockSel) lockSel.value = String(min);
}

function resetActivity() { _lastActivity = Date.now(); }

function checkIdle() {
  if (_sessionLocked) return;
  const timeout = getIdleTimeout() * 60 * 1000;
  if (timeout > 0 && Date.now() - _lastActivity > timeout) {
    lockSession();
  }
}

function lockSession() {
  _sessionLocked = true;
  const overlay = document.getElementById('lock-overlay');
  overlay.style.display = 'flex';
}

function unlockSession() {
  _sessionLocked = false;
  _lastActivity = Date.now();
  document.getElementById('lock-overlay').style.display = 'none';
}

['mousemove', 'keydown', 'click', 'scroll'].forEach(evt =>
  document.addEventListener(evt, resetActivity, { passive: true })
);
setInterval(checkIdle, 15000);

// ── Cooldown ─────────────────────────────────────

function getCooldown() {
  return parseInt(localStorage.getItem('ci-lp-cooldown') || String(window.DEFAULT_COOLDOWN), 10);
}

async function setCooldown(val) {
  val = parseInt(val, 10);
  localStorage.setItem('ci-lp-cooldown', String(val));
  const slider = document.getElementById('cooldown-slider');
  if (slider) slider.value = val;
  const label = document.getElementById('cooldown-slider-value');
  if (label) label.textContent = formatCooldown(val);
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.CSRF_TOKEN },
      body: JSON.stringify({ cooldown: val }),
    });
  } catch (e) {}
}

function initCooldown() {
  const saved = getCooldown();
  const slider = document.getElementById('cooldown-slider');
  if (slider) slider.value = saved;
  const label = document.getElementById('cooldown-slider-value');
  if (label) label.textContent = formatCooldown(saved);
  setCooldown(saved);
}

// ── Trigger ───────────────────────────────────────

function toast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

function buildGhCommand(job) {
  let cmd = `gh workflow run ${job.file} -R ${job.repo} --ref ${job.branch || 'main'}`;
  for (const [k, v] of Object.entries(job.params)) {
    if (v) cmd += ` -f ${k}=${v}`;
  }
  return cmd;
}

function triggerSelected() {
  if (_sessionLocked) { toast('Session locked — click to unlock first', 'error'); return; }

  const user = getUser();
  if (!user) {
    toast('Set a display name or authenticate with gh first', 'error');
    return;
  }

  const now = Date.now();
  if (now < _cooldownUntil) {
    const wait = Math.ceil((_cooldownUntil - now) / 1000);
    toast(`Cooldown active — wait ${wait}s before triggering again`, 'error');
    return;
  }

  const branch = getBranch();
  const jobs = [];
  for (const idx of state.selected) {
    const card = document.querySelector(`.wf-card[data-idx="${idx}"]`);
    const wf = WORKFLOWS[idx];
    jobs.push({ file: wf.file, label: wf.label, params: getCardParams(card), user, repo: currentRepo, branch });
  }

  showConfirmModal(jobs);
}

function showConfirmModal(jobs) {
  const rows = jobs.map(j => {
    const paramEntries = Object.entries(j.params).filter(([_, v]) => v);
    let paramsHtml;
    if (paramEntries.length) {
      const gridRows = paramEntries.map(([k, v]) =>
        `<div class="confirm-param-key">${k}</div><div class="confirm-param-val">${v}</div>`
      ).join('');
      paramsHtml = `
        <details class="confirm-params-details" open>
          <summary>${paramEntries.length} option(s) passed</summary>
          <div class="confirm-params-grid">${gridRows}</div>
        </details>`;
    } else {
      paramsHtml = '<div class="confirm-params-empty">no options</div>';
    }

    return `
      <div class="confirm-job">
        <div class="confirm-job-name">${j.label}</div>
        <div class="confirm-job-file">${j.file} &middot; branch: <b>${j.branch || 'main'}</b></div>
        ${paramsHtml}
        <details class="confirm-cmd-details">
          <summary>gh command</summary>
          <code class="confirm-cmd">${buildGhCommand(j)}</code>
        </details>
      </div>`;
  }).join('');

  const modal = document.getElementById('confirm-modal');
  modal.querySelector('.confirm-body').innerHTML = `
    <div class="confirm-header">
      <div class="confirm-icon">&#9888;</div>
      <div>
        <h3>Confirm trigger</h3>
        <p>You are about to trigger <b>${jobs.length}</b> workflow(s) on <b>${currentRepo}</b></p>
      </div>
    </div>
    <div class="confirm-jobs">${rows}</div>
    <div class="confirm-footer">
      <button class="btn btn-outline" onclick="closeConfirmModal()">Cancel</button>
      <button class="btn btn-danger" id="confirm-trigger-btn" onclick="executeTrigger()">Yes, trigger ${jobs.length} workflow(s)</button>
    </div>`;
  modal._jobs = jobs;
  modal.style.display = 'flex';
}

function closeConfirmModal() {
  document.getElementById('confirm-modal').style.display = 'none';
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function executeTrigger() {
  const modal = document.getElementById('confirm-modal');
  const jobs = modal._jobs;
  closeConfirmModal();

  const btn = document.getElementById('trigger-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Triggering...';

  const cooldown = getCooldown();
  const batchId = jobs.length > 1 ? crypto.randomUUID() : undefined;
  let ok = 0;
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const isLast = i === jobs.length - 1;
    const payload = { ...job };
    if (batchId) {
      payload.batch_id = batchId;
      if (isLast) payload.batch_last = true;
    }
    try {
      const res = await fetch('/api/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.CSRF_TOKEN },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.ok) { toast(`Triggered: ${job.label} (${i + 1}/${jobs.length})`, 'success'); ok++; }
      else {
        toast(`Failed: ${job.label} — ${data.error}`, 'error');
        if (data.retry_after) _cooldownUntil = Date.now() + data.retry_after * 1000;
      }
    } catch (e) { toast(`Error: ${job.label} — ${e.message}`, 'error'); }
    if (!isLast && ok > 0) await _sleep(1000);
  }

  btn.disabled = false;
  btn.textContent = 'Trigger Selected';
  if (ok > 0) {
    _cooldownUntil = Date.now() + cooldown * 1000;
    toast(`${ok} workflow(s) triggered — ${cooldown}s cooldown active`, 'info');
  }
}

// ── Runs ──────────────────────────────────────────

async function loadRuns() {
  const container = document.getElementById('runs-container');
  container.innerHTML = '<div class="empty-state"><span class="spinner"></span> Loading...</div>';
  try {
    const res = await fetch('/api/runs?repo=' + encodeURIComponent(currentRepo));
    const data = await res.json();
    if (!data.runs || !data.runs.length) {
      container.innerHTML = '<div class="empty-state"><p>No recent runs.</p></div>';
      return;
    }
    const log = data.triggerLog || [];
    let html = `<table class="runs-table">
      <thead><tr><th style="width:24px"></th><th>Run</th><th>Workflow</th><th>Status</th><th>Triggered by</th><th>Branch</th><th>Started</th></tr></thead><tbody>`;
    for (const r of data.runs) {
      const badge = statusBadge(r.status, r.conclusion);
      const time = new Date(r.createdAt).toLocaleString();
      const rt = new Date(r.createdAt).getTime();
      const match = log.find(e => Math.abs(new Date(e.time).getTime() - rt) < 120000);
      const userCell = match
        ? `<span style="color:var(--accent);font-weight:600">${match.user}</span>`
        : '<span style="color:var(--dimmer)">—</span>';
      html += `<tr class="run-row" onclick="toggleRunDetail(this)">
        <td><span class="expand-arrow">&#9654;</span></td>
        <td><a href="https://github.com/${currentRepo}/actions/runs/${r.databaseId}" target="_blank" onclick="event.stopPropagation()">#${r.databaseId}</a></td>
        <td>${r.name}</td><td>${badge}</td><td>${userCell}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:0.8rem">${r.headBranch || '—'}</td>
        <td style="color:var(--dim)">${time}</td></tr>`;
      html += `<tr class="run-detail-row"><td colspan="7"><div class="run-detail-content">${
        match ? renderRunDetail(match) : '<span class="run-detail-empty">Triggered externally — no options recorded</span>'
      }</div></td></tr>`;
    }
    container.innerHTML = html + '</tbody></table>';
  } catch (e) {
    container.innerHTML = `<div class="empty-state" style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

function toggleRunDetail(row) {
  row.classList.toggle('expanded');
}

function renderRunDetail(logEntry) {
  const p = logEntry.params || {};
  const keys = Object.entries(p).filter(([_, v]) => v);
  if (!keys.length) return '<span class="run-detail-empty">No options passed</span>';

  let html = '<div class="run-detail-grid">';
  for (const [k, v] of keys) {
    html += `<div class="run-detail-key">${k}</div><div class="run-detail-val">${v}</div>`;
  }
  html += '</div>';

  if (logEntry.cmd) {
    const cmdStr = Array.isArray(logEntry.cmd) ? logEntry.cmd.join(' ') : logEntry.cmd;
    html += `<div class="run-detail-cmd"><code>${cmdStr}</code></div>`;
  }
  return html;
}

function statusBadge(status, conclusion) {
  if (status === 'completed') {
    if (conclusion === 'success')   return '<span class="badge badge-success">&#10003; success</span>';
    if (conclusion === 'failure')   return '<span class="badge badge-failure">&#10007; failure</span>';
    if (conclusion === 'cancelled') return '<span class="badge badge-cancelled">cancelled</span>';
    return `<span class="badge badge-cancelled">${conclusion}</span>`;
  }
  if (status === 'in_progress') return '<span class="badge badge-progress"><span class="spinner"></span> running</span>';
  if (status === 'queued') return '<span class="badge badge-pending">queued</span>';
  return `<span class="badge badge-pending">${status}</span>`;
}

// ── Auto-refresh ─────────────────────────────────

function toggleAutoRefresh(on) {
  if (on) {
    _autoRefreshTimer = setInterval(() => {
      const activeTab = document.querySelector('.tab.active');
      if (activeTab && activeTab.dataset.tab === 'runs') loadRuns();
    }, 30000);
    toast('Auto-refresh enabled (every 30s)', 'info');
  } else {
    stopAutoRefresh();
  }
}

function stopAutoRefresh() {
  if (_autoRefreshTimer) {
    clearInterval(_autoRefreshTimer);
    _autoRefreshTimer = null;
  }
  const cb = document.getElementById('auto-refresh-toggle');
  if (cb) cb.checked = false;
}

// ── History ───────────────────────────────────────

async function loadHistory() {
  const container = document.getElementById('history-container');
  container.innerHTML = '<div class="empty-state"><span class="spinner"></span> Loading...</div>';
  try {
    const res = await fetch('/api/trigger-log');
    const data = await res.json();
    if (!data.log || !data.log.length) {
      container.innerHTML = '<div class="empty-state"><p>No triggers recorded yet.</p></div>';
      return;
    }
    let html = `<table class="runs-table">
      <thead><tr><th>User</th><th>Workflow</th><th>Branch</th><th>Rancher</th><th>Cluster</th><th>Runner</th><th>QASE</th><th>Destroy</th><th>Time</th></tr></thead><tbody>`;
    for (const entry of data.log) {
      const time = new Date(entry.time).toLocaleString();
      const p = entry.params || {};
      const runner = !p.runner_template ? '—' : (p.runner_template.includes('dedicated') ? 'Dedicated' : 'Spot');
      const qase = p.qase_report === 'true' ? (p.qase_run_id || 'auto') : 'off';
      const branch = entry.branch || 'main';
      html += `<tr>
        <td><span style="color:var(--accent);font-weight:600">${entry.user}</span></td>
        <td>${entry.workflow}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:0.8rem">${branch}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:0.8rem">${p.rancher_version || '—'}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:0.8rem">${p.upstream_cluster_version || '—'}</td>
        <td>${runner}</td>
        <td>${qase}</td>
        <td>${p.destroy_runner === 'false' ? '<span style="color:var(--yellow)">No</span>' : '<span style="color:var(--dim)">Yes</span>'}</td>
        <td style="color:var(--dim)">${time}</td></tr>`;
    }
    container.innerHTML = html + '</tbody></table>';
  } catch (e) {
    container.innerHTML = `<div class="empty-state" style="color:var(--red)">Error: ${e.message}</div>`;
  }
}

// ── Presets ───────────────────────────────────────

function getPresets() {
  try { return JSON.parse(localStorage.getItem('ci-lp-presets') || '{}'); } catch (e) { return {}; }
}

function togglePresetsMenu() {
  const menu = document.getElementById('presets-menu');
  menu.classList.toggle('show');
  if (menu.classList.contains('show')) refreshPresetList();
}

function closePresetsMenu() {
  document.getElementById('presets-menu').classList.remove('show');
}

document.addEventListener('click', e => {
  const wrapper = document.querySelector('.presets-wrapper');
  if (wrapper && !wrapper.contains(e.target)) closePresetsMenu();
});

function refreshPresetList() {
  const list = document.getElementById('presets-menu-list');
  const presets = getPresets();
  const names = Object.keys(presets).sort();
  if (!names.length) {
    list.innerHTML = '<div class="presets-empty">No favorites saved yet</div>';
    return;
  }
  list.innerHTML = names.map(n => `
    <div class="preset-item" onclick="loadPreset('${n.replace(/'/g, "\\'")}')">
      <span class="preset-item-name">${n}</span>
      <button class="preset-item-del" onclick="event.stopPropagation(); deletePreset('${n.replace(/'/g, "\\'")}')" title="Delete">&#10005;</button>
    </div>
  `).join('');
}

function savePreset() {
  const name = prompt('Give this favorite a name:');
  if (!name) return;

  const snapshot = [];
  document.querySelectorAll('.wf-card').forEach(card => {
    const idx = parseInt(card.dataset.idx);
    const wf = WORKFLOWS[idx];
    snapshot.push({
      file: wf.file,
      selected: state.selected.has(idx),
      params: getCardParams(card),
    });
  });

  const presets = getPresets();
  presets[name] = { branch: getBranch(), cards: snapshot };
  localStorage.setItem('ci-lp-presets', JSON.stringify(presets));
  refreshPresetList();
  toast(`Saved favorite "${name}"`, 'success');
}

function loadPreset(name) {
  const presets = getPresets();
  const preset = presets[name];
  if (!preset) { toast('Favorite not found', 'error'); return; }

  if (preset.branch) {
    document.getElementById('branch-input').value = preset.branch;
    localStorage.setItem('ci-lp-branch', preset.branch);
    autoSizeInput(document.getElementById('branch-input'));
  }

  state.selected.clear();
  for (const snap of preset.cards) {
    const idx = WORKFLOWS.findIndex(w => w.file === snap.file);
    if (idx < 0) continue;
    const card = document.querySelector(`.wf-card[data-idx="${idx}"]`);
    if (!card) continue;

    if (snap.selected) state.selected.add(idx);

    for (const [k, v] of Object.entries(snap.params)) {
      const el = card.querySelector(`[data-field="${k}"], [data-dispatch="${k}"], [data-extra="${k}"], [data-qase="${k}"]`);
      if (el) {
        if (el.type === 'checkbox') el.checked = v === 'true';
        else if (el.classList.contains('cluster-version')) setClusterSelectValue(el, v);
        else el.value = v;
      }

      if (k === 'grep_test_by_tag') {
        const activeTags = v.split(/\s+/).filter(Boolean);
        card.querySelectorAll('.tag-pill').forEach(pill => {
          pill.classList.toggle('active', activeTags.includes(pill.textContent));
        });
      }
    }
  }

  closePresetsMenu();
  updateSelection();
  toast(`Loaded "${name}"`, 'info');
}

function deletePreset(name) {
  if (!confirm(`Delete favorite "${name}"?`)) return;

  const presets = getPresets();
  delete presets[name];
  localStorage.setItem('ci-lp-presets', JSON.stringify(presets));
  refreshPresetList();
  toast(`Deleted "${name}"`, 'info');
}

// ── Keyboard shortcuts ───────────────────────────

document.addEventListener('keydown', e => {
  if (_sessionLocked) return;
  const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

  // Ctrl+Enter — trigger selected
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    triggerSelected();
    return;
  }

  // Ctrl+A — select all (only when not in an input)
  if (e.ctrlKey && e.key === 'a' && !inInput) {
    e.preventDefault();
    selectAll();
    return;
  }

  // Escape — close modals/panels
  if (e.key === 'Escape') {
    const settingsPanel = document.getElementById('settings-panel');
    if (settingsPanel.classList.contains('open')) {
      toggleSettings();
      return;
    }
    closeConfirmModal();
    return;
  }
});

// ── Init ──────────────────────────────────────────
initTheme();
detectUser();
initRepo();
initCooldown();
initSettings();
loadClusterVersions();
