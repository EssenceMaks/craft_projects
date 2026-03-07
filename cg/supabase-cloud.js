// ════════════════════════════════════════════════════════════════
// SUPABASE CLOUD INTEGRATION v2 — Component Generator
// ════════════════════════════════════════════════════════════════
// Called explicitly: initCloud() at bottom of HTML
'use strict';

// ── Cloud state ───────────────────────────────────────────────
const SC = {
  client: null,
  user: null,
  projectBase: null,    // base name, e.g. 'project_1'
  workingMode: null,    // 'central' | 'local' | null
  currentInstanceId: null,  // loaded central instance id
  currentLocalSave: null,  // loaded local save name
  channel: null,    // own live broadcast channel
  watchChannel: null,    // channel for watching another user
  globalChannel: null,    // shared presence/announcement channel
  liveMode: false,   // WE are broadcasting
  watchMode: false,   // watching/co-editing someone else
  watchReadOnly: false,   // true = watch only, no edits sent
  watchTarget: null,    // userId being watched
  liveCursors: {},      // { userId: domElement }
  notes: {},      // { userId: { x,y,text } }
  noteMode: false,
  noteModeTimer: null,
  lastCursorX: 0,
  lastCursorY: 0,
  lastMouseScr: null,
  applyingRemote: false,
  autosaveTimer: null,
  localTimer: null,
  cursorThrottle: null,
  broadcastTimer: null,    // debounce for canvas broadcast
  loginSelected: null,
  modalRefreshTimer: null,  // auto-refresh while cloud modal is open
  _switchingUser: false,
};
let _origRenderCanvas = null;

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════
window.initCloud = function () {
  if (typeof supabase === 'undefined') {
    console.warn('[Cloud] supabase-js not loaded');
    return;
  }
  try {
    SC.client = supabase.createClient(SUPA_URL, SUPA_KEY);
  } catch (e) {
    console.error('[Cloud] createClient failed:', e);
    return;
  }
  // Inject cursor layer into canvas
  const ca = document.getElementById('ca');
  if (ca && !document.getElementById('cursors-layer')) {
    const cl = document.createElement('div');
    cl.id = 'cursors-layer';
    cl.style.cssText = 'position:absolute;top:0;left:0;width:4000px;height:3000px;pointer-events:none;z-index:200;';
    ca.appendChild(cl);
    // Unified mousemove: track position + broadcast cursor in any collab mode
    ca.addEventListener('mousemove', e => {
      const rect = ca.getBoundingClientRect();
      SC.lastCursorX = Math.round(ca.scrollLeft + e.clientX - rect.left);
      SC.lastCursorY = Math.round(ca.scrollTop + e.clientY - rect.top);
      SC.lastMouseScr = { x: e.clientX, y: e.clientY };
      // Move my own note bubble with cursor
      const myNote = document.getElementById('note_' + SC.user?.id);
      if (myNote && SC.notes[SC.user?.id]) {
        myNote.style.left = (SC.lastCursorX + 16) + 'px';
        myNote.style.top = SC.lastCursorY + 'px';
      }
      // Broadcast cursor (live host OR watcher co-edit)
      const ch = SC.liveMode ? SC.channel : (SC.watchMode ? SC.watchChannel : null);
      if (!ch || !SC.user) return;
      if (SC.cursorThrottle) return;
      SC.cursorThrottle = setTimeout(() => { SC.cursorThrottle = null; }, 50);
      ch.send({
        type: 'broadcast', event: 'cursor',
        payload: {
          uid: SC.user.id, name: SC.user.name, color: SC.user.color, av: SC.user.av,
          x: SC.lastCursorX, y: SC.lastCursorY,
          note: SC.notes[SC.user.id]?.text || null
        }
      });
    });
  }
  // Hook renderCanvas: reattach cursors-layer (renderCanvas wipes ca.innerHTML)
  // and broadcast canvas changes when in collab mode
  if (window.renderCanvas && !_origRenderCanvas) {
    _origRenderCanvas = window.renderCanvas;
    window.renderCanvas = function (...args) {
      _origRenderCanvas.apply(this, args);
      _reattachCursorsLayer();
      if (!SC.applyingRemote) broadcastCanvasUpdate();
    };
  }
  // e + Enter → open note overlay
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    const noteOpen = document.getElementById('note-overlay')?.style.display !== 'none';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (noteOpen) {
      if (e.key === 'Enter') { e.preventDefault(); submitNote(); }
      if (e.key === 'Escape') cancelNote();
      return;
    }
    if (e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      SC.noteMode = true;
      if (SC.noteModeTimer) clearTimeout(SC.noteModeTimer);
      SC.noteModeTimer = setTimeout(() => { SC.noteMode = false; }, 1500);
    }
    if (e.key === 'Enter' && SC.noteMode) {
      e.preventDefault();
      SC.noteMode = false;
      if (SC.noteModeTimer) { clearTimeout(SC.noteModeTimer); SC.noteModeTimer = null; }
      // Toggle: if note exists for me, remove it; else open input
      if (SC.notes[SC.user?.id]) { removeMyNote(); } else { openNoteOverlay(); }
    }
  });
  // Note textarea word count
  document.getElementById('note-textarea')?.addEventListener('input', e => {
    const words = e.target.value.trim().split(/\s+/).filter(w => w).length;
    const el = document.getElementById('note-word-count');
    if (el) el.textContent = words + ' слов';
  });
  restoreSession();
  startLocalAutosave();
  buildLoginModal();
};

// ════════════════════════════════════════════════════════════════
// AUTH (Soft — no Supabase registration needed)
// ════════════════════════════════════════════════════════════════
function restoreSession() {
  const saved = localStorage.getItem('cg_user') || localStorage.getItem('ws_user');
  if (saved) {
    try {
      SC.user = JSON.parse(saved);
      renderUserBadge();
      // Join global presence channel now that we have a user
      setTimeout(joinGlobalChannel, 800);
      return;
    } catch (e) { }
  }
  showLoginModal();
}

window.showLoginModal = function () {
  const m = document.getElementById('cloud-login-modal');
  if (!m) return;
  m.classList.remove('hidden');
  // Show/hide close button: available only when a user is already logged in (switching)
  const closeBtn = document.getElementById('login-modal-close');
  if (closeBtn) closeBtn.style.display = SC.user ? '' : 'none';
};

window.closeLoginModal = function () {
  document.getElementById('cloud-login-modal')?.classList.add('hidden');
  SC._switchingUser = false;
  // Reset selection state
  SC.loginSelected = null;
  document.querySelectorAll('.login-user-card').forEach(c => c.classList.remove('sel'));
  if (document.getElementById('login-pass')) document.getElementById('login-pass').value = '';
};

function buildLoginModal() {
  const list = document.getElementById('login-user-list');
  if (!list) return;
  list.innerHTML = TEAM_USERS.map(u => {
    const isCurrent = SC.user?.id === u.id;
    return `<div class="login-user-card" data-uid="${u.id}"
         style="border-left:4px solid ${u.color};${isCurrent ? 'opacity:.45;pointer-events:none;' : ''}" 
         onclick="selectLoginUser('${u.id}')">
      <span class="login-av" style="background:${u.color};">${u.av}</span>
      <span style="font-weight:700;">${u.name}</span>
      ${isCurrent ? '<span style="font-size:9px;color:#9ca3af;margin-left:auto;">✓ здесь</span>' : ''}
    </div>`;
  }).join('');
  // Update modal title if switching
  const title = document.getElementById('login-modal-title');
  if (title) title.textContent = SC._switchingUser ? '🔄 Сменить пользователя' : 'Войти';
}

window.selectLoginUser = function (uid) {
  SC.loginSelected = uid;
  document.querySelectorAll('.login-user-card').forEach(c =>
    c.classList.toggle('sel', c.dataset.uid === uid)
  );
  document.getElementById('login-pass')?.focus();
};

window.doLogin = function () {
  const uid = SC.loginSelected;
  const pass = document.getElementById('login-pass')?.value || '';
  if (!uid) { cloudToast('Выберите пользователя', 'warn'); return; }
  const u = TEAM_USERS.find(u => u.id === uid);
  if (!u || u.pass !== pass) { cloudToast('Неверный пароль!', 'error'); return; }
  // If switching from an existing user, don't restore draft (already have canvas)
  const isSwitching = SC._switchingUser || (SC.user && SC.user.id !== u.id);
  SC._switchingUser = false;
  SC.user = { id: u.id, name: u.name, color: u.color, av: u.av };
  localStorage.setItem('cg_user', JSON.stringify(SC.user));
  renderUserBadge();
  document.getElementById('cloud-login-modal').classList.add('hidden');
  if (document.getElementById('login-pass')) document.getElementById('login-pass').value = '';
  SC.loginSelected = null;
  document.querySelectorAll('.login-user-card').forEach(c => c.classList.remove('sel'));
  cloudToast((isSwitching ? 'Смена аккаунта: ' : 'Привет, ') + u.name + '!', 'success');
  if (!isSwitching) restoreLocalDraft();
  // Join global presence channel after login
  setTimeout(joinGlobalChannel, 600);
};

window.logoutUser = function () {
  SC.user = null; SC.projectBase = null;
  localStorage.removeItem('cg_user');
  stopLiveSession();
  renderUserBadge();
  showLoginModal();
};

function renderUserBadge() {
  const b = document.getElementById('user-badge');
  if (!b) return;
  if (SC.user) {
    b.innerHTML = `<span style="background:${SC.user.color};color:#fff;padding:3px 9px;border-radius:10px;
        font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px;"
        onclick="showAccountPanel()" title="Аккаунт">
        ${SC.user.av} ${SC.user.name}
      </span>`;
  } else {
    b.innerHTML = `<button class="btn btn-s" onclick="showLoginModal()"
      style="font-size:11px;padding:3px 9px;">Войти</button>`;
  }
  const lbl = document.getElementById('cloud-project-label');
  if (lbl) lbl.textContent = SC.projectBase ? '📁 ' + SC.projectBase : '—';
  renderContextBar();
}

// ── Account panel (click on badge) ──────────────────────────────
window.showAccountPanel = function () {
  // Remove old panel if any
  document.getElementById('account-panel')?.remove();
  if (!SC.user) { showLoginModal(); return; }

  const panel = document.createElement('div');
  panel.id = 'account-panel';
  panel.style.cssText = 'position:fixed;top:46px;right:10px;z-index:4000;background:#fff;'
    + 'border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;box-shadow:0 8px 28px rgba(0,0,0,.18);'
    + 'min-width:200px;max-width:260px;';

  const u = SC.user;
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="background:${u.color};color:#fff;width:30px;height:30px;border-radius:50%;
          display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;">${u.av}</span>
        <div>
          <div style="font-weight:700;font-size:13px;">${u.name}</div>
          <div style="font-size:10px;color:#9ca3af;">@${u.id}</div>
        </div>
      </div>
      <span onclick="closeAccountPanel()" style="cursor:pointer;color:#9ca3af;font-size:18px;line-height:1;padding:2px 5px;"
        title="Закрыть">×</span>
    </div>
    <div style="font-size:10px;color:#6b7280;margin-bottom:10px;border-top:1px solid #f3f4f6;padding-top:8px;">
      ${SC.liveMode ? '<span style="color:#22c55e;font-weight:700;">● LIVE активен</span>' : ''}
      ${SC.watchMode ? '<span style="color:#3b82f6;font-weight:700;">✏️ Совм. сессия</span>' : ''}
      ${SC.workingMode === 'central' ? '🌐 ' + (SC.currentInstanceId || 'центральный') : ''}
      ${SC.workingMode === 'local' ? '💾 ' + (SC.currentLocalSave || 'локальный') : ''}
      ${!SC.workingMode ? '― черновик' : ''}
    </div>
    <button class="btn btn-s" onclick="_switchAccount()" style="width:100%;font-size:11px;margin-bottom:6px;">
      🔄 Сменить пользователя
    </button>
    <button class="btn btn-rl" onclick="_confirmLogout()" style="width:100%;font-size:11px;">
      → Выйти
    </button>`;

  document.body.appendChild(panel);

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('mousedown', _outsideAccountClose, { once: true });
  }, 50);
};

function _outsideAccountClose(e) {
  if (!document.getElementById('account-panel')?.contains(e.target)) {
    closeAccountPanel();
  }
}

window.closeAccountPanel = function () {
  document.getElementById('account-panel')?.remove();
  document.removeEventListener('mousedown', _outsideAccountClose);
};

window._switchAccount = function () {
  closeAccountPanel();
  const hasActivity = SC.liveMode || SC.watchMode;
  if (hasActivity) {
    if (!confirm('Вы в активной Live/совместной сессии. Выйти из неё и сменить пользователя?')) return;
    if (SC.liveMode) stopLiveSession();
    if (SC.watchMode) stopWatching();
  }
  // Mark that we're switching (not a fresh login)
  SC._switchingUser = true;
  buildLoginModal();
  showLoginModal();
};

window._confirmLogout = function () {
  closeAccountPanel();
  const hasActivity = SC.liveMode || SC.watchMode;
  if (hasActivity && !confirm('Вы в активной сессии. Выйти?')) return;
  SC.user = null; SC.projectBase = null;
  SC._switchingUser = false;
  localStorage.removeItem('cg_user');
  if (SC.liveMode) stopLiveSession();
  if (SC.watchMode) stopWatching();
  renderUserBadge();
  showLoginModal();
};

// ════════════════════════════════════════════════════════════════
// LOCAL AUTOSAVE (localStorage — always free, no internet)
// ════════════════════════════════════════════════════════════════
function startLocalAutosave() {
  if (SC.localTimer) clearInterval(SC.localTimer);
  SC.localTimer = setInterval(() => {
    try {
      localStorage.setItem('cg_draft', JSON.stringify({
        items: S.items, connections: S.connections,
        projectBase: SC.projectBase, ts: Date.now()
      }));
    } catch (e) { }
  }, 15000);
}

// Live: autosave to cloud every 3 min (only host's live record, not a new instance)
function startLiveAutosave() {
  if (SC.autosaveTimer) clearInterval(SC.autosaveTimer);
  SC.autosaveTimer = setInterval(async () => {
    if (!SC.liveMode || !SC.user || !SC.client) return;
    await SC.client.from('projects').upsert({
      id: 'live_' + SC.user.id,
      name: 'Live: ' + SC.user.name,
      data: JSON.parse(JSON.stringify({ items: S.items, connections: S.connections })),
      owner: SC.user.id, live: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });
  }, 3 * 60 * 1000);
}
function stopLiveAutosave() {
  if (SC.autosaveTimer) { clearInterval(SC.autosaveTimer); SC.autosaveTimer = null; }
}

function restoreLocalDraft() {
  const raw = localStorage.getItem('cg_draft');
  if (!raw) return;
  try {
    const d = JSON.parse(raw);
    if (!d.items?.length && !d.connections?.length) return;
    const ago = Math.round((Date.now() - (d.ts || 0)) / 60000);
    if (!confirm(`Найден черновик (${ago} мин. назад). Восстановить?`)) return;
    S.items = d.items || [];
    S.connections = d.connections || [];
    if (d.projectBase) SC.projectBase = d.projectBase;
    renderCanvas(); renderDom(); updAnimBtn(); updPreview();
    renderUserBadge();
    cloudToast('Черновик восстановлен', 'success');
  } catch (e) { }
}

// ════════════════════════════════════════════════════════════════
// INSTANCE SYSTEM — Central Supabase server
// ════════════════════════════════════════════════════════════════

// Count existing instances for a base name
async function getNextInstanceNum(baseName) {
  if (!SC.client) return 1;
  const { data } = await SC.client.from('projects')
    .select('id')
    .ilike('id', baseName + '_%')
    .not('id', 'ilike', 'live_%');
  if (!data || !data.length) return 1;
  const nums = data.map(r => {
    const m = r.id.match(/_экземпляр_(\d+)/);
    return m ? parseInt(m[1]) : 0;
  });
  return Math.max(...nums, 0) + 1;
}

// Push current canvas state to central as a new instance
window.pushToCenter = async function (baseName) {
  if (!SC.client) { cloudToast('Supabase не настроен', 'warn'); return; }
  if (!SC.user) { showLoginModal(); return; }
  const nameInput = document.getElementById('cloud-new-name');
  const base = (baseName || nameInput?.value?.trim() || SC.projectBase ||
    prompt('Базовое имя проекта:', DEFAULT_PROJECT_NAME));
  if (!base) return;
  SC.projectBase = base.trim().toLowerCase().replace(/\s+/g, '_');
  if (nameInput) nameInput.value = '';
  const n = await getNextInstanceNum(SC.projectBase);
  const instanceId = SC.projectBase + '_экземпляр_' + n;
  const { error } = await SC.client.from('projects').insert({
    id: instanceId, name: instanceId,
    data: JSON.parse(JSON.stringify({ items: S.items, connections: S.connections })),
    owner: SC.user.id, live: false,
    updated_at: new Date().toISOString()
  });
  if (error) { cloudToast('Ошибка: ' + error.message, 'error'); return; }
  renderUserBadge();
  cloudToast('📤 Отправлено: ' + instanceId, 'success');
  return instanceId;
};

// Load a central instance to local working state
window.loadInstance = async function (instanceId) {
  if (!SC.client) { cloudToast('Supabase не настроен', 'warn'); return; }
  const { data, error } = await SC.client.from('projects').select('*').eq('id', instanceId).single();
  if (error || !data) { cloudToast('Не найден: ' + (error?.message || ''), 'error'); return; }
  S.items = data.data?.items || [];
  S.connections = data.data?.connections || [];
  S.selId = null; S.selIds = []; S.selIsCopy = false; S.selConnId = null;
  const m = instanceId.match(/^(.+)_экземпляр_\d+$/);
  SC.projectBase = m ? m[1] : instanceId;
  SC.workingMode = 'central';
  SC.currentInstanceId = instanceId;
  SC.currentLocalSave = null;
  renderCanvas(); renderDom(); updAnimBtn(); updPreview();
  renderUserBadge();
  cloudToast('Загружен: ' + instanceId, 'success');
};

// Delete a central instance
window.deleteInstance = async function (id) {
  if (!confirm('Удалить ' + id + '?')) return;
  if (!SC.client) return;
  await SC.client.from('projects').delete().eq('id', id);
  cloudToast('Удалено: ' + id, 'info');
  await refreshCloudModal();
};

// Save locally with a chosen name (Approve)
window.approveLocal = function () {
  const def = (SC.projectBase || 'project') + '_апрув_' + new Date().toISOString().slice(0, 10);
  const name = prompt('Название локального апрува:', def);
  if (!name) return;
  const saves = JSON.parse(localStorage.getItem('cg_local_saves') || '[]');
  saves.unshift({
    id: name.trim().replace(/\s+/g, '_'),
    name: name.trim(), ts: Date.now(),
    data: JSON.parse(JSON.stringify({ items: S.items, connections: S.connections }))
  });
  localStorage.setItem('cg_local_saves', JSON.stringify(saves.slice(0, 10)));
  cloudToast('💾 Сохранено: ' + name, 'success');
};

// Load a local save
window.loadLocalSave = function (id) {
  const saves = JSON.parse(localStorage.getItem('cg_local_saves') || '[]');
  const s = saves.find(x => x.id === id);
  if (!s) { cloudToast('Не найдено', 'error'); return; }
  S.items = s.data?.items || []; S.connections = s.data?.connections || [];
  S.selId = null; S.selIds = []; S.selIsCopy = false; S.selConnId = null;
  SC.workingMode = 'local';
  SC.currentLocalSave = s.name;
  SC.currentInstanceId = null;
  renderCanvas(); renderDom(); updAnimBtn(); updPreview();
  cloudToast('Загружен: ' + s.name, 'success');
};

// Push a local save to central as a new instance
window.pushLocalSave = async function (id) {
  const saves = JSON.parse(localStorage.getItem('cg_local_saves') || '[]');
  const s = saves.find(x => x.id === id); if (!s) return;
  const prev = { items: S.items, connections: S.connections };
  S.items = s.data.items || []; S.connections = s.data.connections || [];
  await pushToCenter();
  S.items = prev.items; S.connections = prev.connections;
};

// Compatibility aliases
window.saveToCloud = function (type, customName) {
  if (type === 'approved' || type === 'manual') return pushToCenter(customName);
};
window.approveToCloud = window.approveLocal;

// Download snapshot as JSON
window.downloadSnapshot = function () {
  const json = JSON.stringify({ items: S.items, connections: S.connections }, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = (SC.projectBase || 'snapshot') + '_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  cloudToast('Слепок скачан', 'success');
};

// Import snapshot from JSON file
window.importSnapshot = function () {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      S.items = data.items || []; S.connections = data.connections || [];
      S.selId = null; S.selIds = []; S.selIsCopy = false; S.selConnId = null;
      renderCanvas(); renderDom(); updAnimBtn(); updPreview();
      cloudToast('Импортировано', 'success');
    } catch (err) { cloudToast('Ошибка файла', 'error'); }
  };
  input.click();
};

// ════════════════════════════════════════════════════════════════
// CLOUD MODAL (3 tabs: Central / Live / Local)
// ════════════════════════════════════════════════════════════════
window.showCloudModal = async function () {
  const m = document.getElementById('cloud-modal');
  if (!m) return;
  m.classList.remove('hidden');
  await refreshCloudModal();
  // Auto-refresh live list every 20s while modal is open
  if (SC.modalRefreshTimer) clearInterval(SC.modalRefreshTimer);
  SC.modalRefreshTimer = setInterval(() => {
    if (!document.getElementById('cloud-modal')?.classList.contains('hidden')) {
      refreshCloudModal();
    } else {
      clearInterval(SC.modalRefreshTimer);
      SC.modalRefreshTimer = null;
    }
  }, 20000);
};

window.closeCloudModal = function () {
  document.getElementById('cloud-modal')?.classList.add('hidden');
  if (SC.modalRefreshTimer) { clearInterval(SC.modalRefreshTimer); SC.modalRefreshTimer = null; }
};

window.switchCloudTab = function (tab) {
  ['central', 'live', 'local'].forEach(t => {
    document.getElementById('ctab-' + t)?.classList.toggle('on', t === tab);
    const p = document.getElementById('ctab-' + t + '-panel');
    if (p) p.style.display = t === tab ? '' : 'none';
  });
};

async function refreshCloudModal() {
  // ── Central instances ─────────────────────────────────────────
  if (!SC.client) {
    document.getElementById('cloud-central-list').innerHTML =
      '<div style="color:var(--mu);font-size:12px;padding:13px;">Supabase не подключён. Проверьте SUPA_URL в supabase-config.js</div>';
  } else {
    const { data: projects } = await SC.client.from('projects')
      .select('id, owner, live, updated_at')
      .not('id', 'ilike', 'live_%')
      .order('id', { ascending: false });

    // Group by base name
    const groups = {};
    (projects || []).forEach(p => {
      const m = p.id.match(/^(.+)_экземпляр_(\d+)$/);
      const base = m ? m[1] : '__other__';
      if (!groups[base]) groups[base] = [];
      groups[base].push({ ...p, num: m ? parseInt(m[2]) : 0 });
    });

    let html = '';
    Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0])).forEach(([base, items]) => {
      html += `<div style="margin-bottom:14px;">
        <div style="font-size:11px;font-weight:700;color:var(--p);padding:4px 0;border-bottom:1px solid #e9d5ff;margin-bottom:6px;">📁 ${base}</div>`;
      items.sort((a, b) => b.num - a.num).forEach(p => {
        html += `<div style="padding:6px 9px;border:1px solid var(--bd);border-radius:5px;margin-bottom:4px;
          background:#fff;display:flex;justify-content:space-between;align-items:center;gap:7px;">
          <div style="flex:1;min-width:0;">
            <span style="font-weight:700;font-size:12px;">Экземпляр ${p.num || p.id}</span>
            <span style="font-size:10px;color:var(--mu);margin-left:7px;">${p.owner || '?'} · ${p.updated_at?.slice(0, 16) || ''}</span>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button class="btn btn-bl" style="font-size:10px;padding:3px 8px;"
              onclick="loadInstance('${p.id}');closeCloudModal();">⬇ Взять</button>
            <button class="btn btn-rl" style="font-size:10px;padding:3px 7px;"
              onclick="deleteInstance('${p.id}')">✕</button>
          </div>
        </div>`;
      });
      html += '</div>';
    });
    document.getElementById('cloud-central-list').innerHTML =
      html || '<div style="color:var(--mu);font-size:12px;padding:13px;">Экземпляров нет. Нажмите «📤 В центральный».</div>';
  }

  // ── Live sessions ─────────────────────────────────────────────
  let liveHtml = '';
  if (SC.client) {
    const { data: liveRecs } = await SC.client.from('projects')
      .select('id, owner, updated_at, version_label').eq('live', true).ilike('id', 'live_%');
    (liveRecs || []).forEach(p => {
      const uid = p.id.replace('live_', '');
      const u = TEAM_USERS.find(x => x.id === uid);
      const isSelf = SC.user?.id === uid;
      const vl = p.version_label || '';
      liveHtml += `<div style="padding:8px 11px;border:2px solid ${u?.color || '#e5e7eb'};
        border-radius:7px;margin-bottom:7px;background:#fff;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="display:inline-block;background:${u?.color || '#8b5cf6'};color:#fff;
              padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;margin-right:6px;">● ${u?.av || '?'}</span>
            <span style="font-weight:700;font-size:12px;">${u?.name || uid}</span>
            <span style="font-size:10px;color:var(--mu);margin-left:6px;">${p.updated_at?.slice(11, 16) || ''}</span>
          </div>
          ${isSelf
          ? '<span style="font-size:10px;color:var(--mu);font-style:italic;">это вы</span>'
          : `<div style="display:flex;gap:5px;">
                <button class="btn btn-s" style="font-size:10px;padding:3px 9px;"
                  onclick="watchLive('${uid}',true);closeCloudModal();">👁 Смотреть</button>
                <button class="btn btn-b" style="font-size:10px;padding:3px 9px;"
                  onclick="watchLive('${uid}',false);closeCloudModal();">✏️ Редактировать</button>
              </div>`
        }
        </div>
        ${vl ? `<div style="font-size:10px;color:#6b7280;margin-top:4px;padding-top:4px;border-top:1px solid #f3f4f6;">
          Версия: <b>${vl}</b></div>` : ''}
      </div>`;
    });
  }
  document.getElementById('cloud-live-list').innerHTML =
    liveHtml || '<div style="color:var(--mu);font-size:12px;padding:9px;">Никто сейчас не в Live режиме</div>';

  // ── Local saves ───────────────────────────────────────────────
  const saves = JSON.parse(localStorage.getItem('cg_local_saves') || '[]');
  let localHtml = saves.map(s => `
    <div style="padding:5px 9px;border:1px solid var(--bd);border-radius:4px;margin-bottom:4px;
      background:#fff;display:flex;justify-content:space-between;align-items:center;">
      <div>
        <span style="font-size:11px;font-weight:700;">${s.name}</span>
        <span style="font-size:9px;color:var(--mu);margin-left:7px;">${new Date(s.ts).toLocaleString('ru')}</span>
      </div>
      <div style="display:flex;gap:4px;">
        <button class="btn btn-bl" style="font-size:10px;padding:2px 7px;"
          onclick="loadLocalSave('${s.id}');closeCloudModal();">↩</button>
        <button class="btn btn-gl" style="font-size:10px;padding:2px 7px;"
          onclick="pushLocalSave('${s.id}')">📤</button>
      </div>
    </div>`).join('');
  document.getElementById('cloud-local-list').innerHTML =
    localHtml || '<div style="color:var(--mu);font-size:12px;padding:9px;">Нет локальных апрувов</div>';
}

// ════════════════════════════════════════════════════════════════
// LIVE SESSION (Supabase Realtime — per-user channels)
// ════════════════════════════════════════════════════════════════

window.toggleLiveSession = async function () {
  if (SC.liveMode) await stopLiveSession();
  else await startLiveSession();
};

async function startLiveSession() {
  if (!SC.client) { cloudToast('Supabase не настроен', 'warn'); return; }
  if (!SC.user) { showLoginModal(); return; }

  // Register live record in DB — try with version_label, fall back without
  const liveId = 'live_' + SC.user.id;
  const versionLabel = SC.workingMode === 'central' ? '🌐 ' + (SC.currentInstanceId || SC.projectBase || 'центральный') :
    SC.workingMode === 'local' ? '💾 ' + (SC.currentLocalSave || 'локальный') :
      SC.projectBase ? SC.projectBase : 'черновик';
  const basePayload = {
    id: liveId, name: 'Live: ' + SC.user.name,
    data: JSON.parse(JSON.stringify({ items: S.items, connections: S.connections })),
    owner: SC.user.id, live: true,
    updated_at: new Date().toISOString()
  };
  let { error } = await SC.client.from('projects')
    .upsert({ ...basePayload, version_label: versionLabel }, { onConflict: 'id' });
  if (error) {
    // Retry without version_label (column may not exist yet in DB)
    console.warn('[Live] upsert with version_label failed, retrying without:', error.message);
    ({ error } = await SC.client.from('projects')
      .upsert(basePayload, { onConflict: 'id' }));
    if (error) { cloudToast('Ошибка Live: ' + error.message, 'error'); console.error('[Live]', error); return; }
  }

  // Create realtime channel named after this user
  const chName = 'live_ch_' + SC.user.id;
  SC.channel = SC.client.channel(chName, {
    config: { broadcast: { self: false }, presence: { key: SC.user.id } }
  });

  SC.channel.on('presence', { event: 'sync' }, () =>
    renderOnlineUsers(SC.channel.presenceState())
  );

  // Handle state request from watchers joining
  SC.channel.on('broadcast', { event: 'request_sync' }, () => {
    SC.channel.send({
      type: 'broadcast', event: 'full_sync',
      payload: { items: S.items, connections: S.connections, base: SC.projectBase }
    });
  });

  // See watchers' cursors
  SC.channel.on('broadcast', { event: 'cursor' }, ({ payload }) => {
    if (payload.uid !== SC.user?.id) updateRemoteCursor(payload);
  });

  // Receive canvas edits from co-editors/watchers
  SC.channel.on('broadcast', { event: 'canvas_update' }, ({ payload }) => {
    if (payload.from === SC.user?.id) return;
    applyRemoteCanvas(payload);
  });

  // Receive note updates from co-editors
  SC.channel.on('broadcast', { event: 'note_update' }, ({ payload }) => {
    if (payload.uid === SC.user?.id) return;
    SC.notes[payload.uid] = { text: payload.text };
    showNoteOnCanvas(payload.uid, payload.name, payload.color, payload.av, payload.x, payload.y, payload.text);
  });

  await SC.channel.subscribe(async status => {
    if (status === 'SUBSCRIBED') {
      await SC.channel.track({ user: SC.user.name, color: SC.user.color, av: SC.user.av });
    }
  });

  SC.liveMode = true;
  startLiveAutosave();
  updateLiveUI('live', SC.user.name);
  cloudToast('● LIVE активен. Другие могут наблюдать за ' + SC.user.name, 'success');
  // Announce on global channel so others are notified immediately
  _globalBroadcast('go_live', { uid: SC.user.id, name: SC.user.name, color: SC.user.color, av: SC.user.av, versionLabel });
  _updateGlobalPresence(true);
}

async function stopLiveSession() {
  stopLiveAutosave();
  if (SC.channel) { await SC.channel.unsubscribe(); SC.channel = null; }
  if (SC.client && SC.user) {
    SC.client.from('projects').update({ live: false }).eq('id', 'live_' + SC.user.id);
  }
  _globalBroadcast('go_offline', { uid: SC.user?.id });
  _updateGlobalPresence(false);
  SC.liveMode = false;
  document.getElementById('online-users').innerHTML = '';
  clearRemoteCursors();
  updateLiveUI('off', '');
  cloudToast('Live остановлен', 'info');
}

// Watch another user's live session (readOnly=true: observe only, no edits sent)
window.watchLive = async function (targetUserId, readOnly) {
  if (!SC.client) { cloudToast('Supabase не настроен', 'warn'); return; }
  if (!SC.user) { showLoginModal(); return; }
  if (SC.watchMode) await stopWatching();

  // Load their latest snapshot first
  const { data: liveRec } = await SC.client.from('projects')
    .select('data').eq('id', 'live_' + targetUserId).single();
  if (liveRec?.data) {
    S.items = liveRec.data.items || [];
    S.connections = liveRec.data.connections || [];
    renderCanvas(); renderDom(); updAnimBtn();
  }

  // Subscribe to host's channel
  const chName = 'live_ch_' + targetUserId;
  SC.watchChannel = SC.client.channel(chName, {
    config: { broadcast: { self: false }, presence: { key: SC.user.id } }
  });

  SC.watchChannel.on('presence', { event: 'sync' }, () =>
    renderOnlineUsers(SC.watchChannel.presenceState())
  );

  SC.watchChannel.on('broadcast', { event: 'full_sync' }, ({ payload }) => {
    S.items = payload.items || S.items;
    S.connections = payload.connections || S.connections;
    if (payload.base) SC.projectBase = payload.base;
    applyRemoteCanvas({ items: S.items, connections: S.connections, from: '__sync__' });
  });

  SC.watchChannel.on('broadcast', { event: 'canvas_update' }, ({ payload }) => {
    if (payload.from === SC.user?.id) return;
    applyRemoteCanvas(payload);
  });

  SC.watchChannel.on('broadcast', { event: 'css_change' }, ({ payload }) =>
    applyRemoteCss(payload)
  );

  SC.watchChannel.on('broadcast', { event: 'cursor' }, ({ payload }) =>
    updateRemoteCursor(payload)
  );

  SC.watchChannel.on('broadcast', { event: 'note_update' }, ({ payload }) => {
    if (payload.uid === SC.user?.id) return;
    SC.notes[payload.uid] = { text: payload.text };
    showNoteOnCanvas(payload.uid, payload.name, payload.color, payload.av, payload.x, payload.y, payload.text);
  });

  await SC.watchChannel.subscribe(async status => {
    if (status === 'SUBSCRIBED') {
      await SC.watchChannel.track({ user: SC.user.name, color: SC.user.color, av: SC.user.av });
      SC.watchChannel.send({ type: 'broadcast', event: 'request_sync', payload: {} });
    }
  });

  SC.watchMode = true;
  SC.watchReadOnly = (readOnly === true);
  SC.watchTarget = targetUserId;
  const u = TEAM_USERS.find(x => x.id === targetUserId);
  const modeLabel = SC.watchReadOnly ? '👁 ' + (u?.name || targetUserId) : '✏️ ' + (u?.name || targetUserId);
  updateLiveUI('watch', modeLabel);
  const msg = SC.watchReadOnly
    ? '👁 Наблюдаете за ' + (u?.name || targetUserId) + ' (только просмотр)'
    : '✏️ Совместное редактирование с ' + (u?.name || targetUserId);
  cloudToast(msg, 'info');
};

async function stopWatching() {
  if (SC.watchChannel) { await SC.watchChannel.unsubscribe(); SC.watchChannel = null; }
  SC.watchMode = false; SC.watchReadOnly = false; SC.watchTarget = null;
  clearRemoteCursors();
  updateLiveUI('off', '');
}

// ════════════════════════════════════════════════════════════════
// GLOBAL PRESENCE CHANNEL (cg_global) — live announcements
// Every logged-in user subscribes so they know who is Live
// ════════════════════════════════════════════════════════════════
function joinGlobalChannel() {
  if (!SC.client || !SC.user || SC.globalChannel) return;
  const ch = SC.client.channel('cg_global', {
    config: { broadcast: { self: false }, presence: { key: SC.user.id } }
  });

  // Presence sync — update live badge whenever state changes
  ch.on('presence', { event: 'sync' }, () => {
    _updateLiveBadgeFromPresence(ch.presenceState());
  });

  // Someone just went live
  ch.on('broadcast', { event: 'go_live' }, ({ payload }) => {
    if (payload.uid === SC.user?.id) return;
    const u = TEAM_USERS.find(x => x.id === payload.uid);
    cloudToast('\u25cf ' + (u?.name || payload.uid) + ' \u043d\u0430\u0447\u0430\u043b Live!', 'info');
    _setLiveBadge(true);
    // Auto-refresh modal if it's open
    if (!document.getElementById('cloud-modal')?.classList.contains('hidden')) {
      refreshCloudModal();
    }
  });

  // Someone stopped live
  ch.on('broadcast', { event: 'go_offline' }, ({ payload }) => {
    if (payload.uid === SC.user?.id) return;
    // Refresh modal live list
    if (!document.getElementById('cloud-modal')?.classList.contains('hidden')) {
      refreshCloudModal();
    }
    // Re-check badge after a moment (give DB time to update)
    setTimeout(() => {
      if (SC.client) {
        SC.client.from('projects').select('id').eq('live', true).ilike('id', 'live_%')
          .then(({ data }) => _setLiveBadge((data || []).length > 0));
      }
    }, 1500);
  });

  ch.subscribe(async status => {
    if (status === 'SUBSCRIBED') {
      await ch.track({
        user: SC.user.name, color: SC.user.color, av: SC.user.av,
        live: SC.liveMode
      });
    }
  });

  SC.globalChannel = ch;
}

function _globalBroadcast(event, payload) {
  if (SC.globalChannel) {
    SC.globalChannel.send({ type: 'broadcast', event, payload }).catch(() => { });
  }
}

function _updateGlobalPresence(isLive) {
  if (SC.globalChannel && SC.user) {
    SC.globalChannel.track({
      user: SC.user.name, color: SC.user.color, av: SC.user.av,
      live: isLive
    }).catch(() => { });
  }
}

function _updateLiveBadgeFromPresence(state) {
  const anyLive = Object.values(state).flat().some(u => u.live && u.user !== SC.user?.name);
  _setLiveBadge(anyLive);
}

function _setLiveBadge(show) {
  // Show a green dot on the "Проекты" / cloud button when someone else is live
  const btn = document.getElementById('btn-cloud');
  if (!btn) return;
  let dot = document.getElementById('global-live-dot');
  if (show) {
    if (!dot) {
      dot = document.createElement('span');
      dot.id = 'global-live-dot';
      dot.title = '\u0415\u0441\u0442\u044c \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0435 Live \u0441\u0435\u0441\u0441\u0438\u0438';
      dot.style.cssText = 'position:absolute;top:3px;right:3px;width:7px;height:7px;'
        + 'background:#22c55e;border-radius:50%;border:1.5px solid #fff;pointer-events:none;';
      btn.style.position = 'relative';
      btn.appendChild(dot);
    }
  } else {
    dot?.remove();
  }
}

// ── Cursor layer: reattach to cvf after renderCanvas wipes ca ────
// renderCanvas() does ca.innerHTML=... which destroys cursors-layer.
// We reattach it to cvf (the inner positioned div) after every render.
function _reattachCursorsLayer() {
  const cvf = document.getElementById('cvf');
  if (!cvf) return;
  let layer = document.getElementById('cursors-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'cursors-layer';
    layer.style.cssText = 'position:absolute;top:0;left:0;width:4000px;height:3000px;pointer-events:none;z-index:200;';
    // Clear stale domElement refs so cursors are re-created
    SC.liveCursors = {};
  }
  if (!cvf.contains(layer)) cvf.appendChild(layer);
}

// ── Co-editing: canvas broadcast (debounced 150ms) ──────────────
function broadcastCanvasUpdate() {
  const ch = SC.liveMode ? SC.channel :
    (SC.watchMode && !SC.watchReadOnly ? SC.watchChannel : null);
  if (!ch || !SC.user) return;
  if (SC.broadcastTimer) clearTimeout(SC.broadcastTimer);
  SC.broadcastTimer = setTimeout(() => {
    SC.broadcastTimer = null;
    ch.send({
      type: 'broadcast', event: 'canvas_update',
      payload: { items: S.items, connections: S.connections, from: SC.user.id }
    });
  }, 150);
}

function applyRemoteCanvas({ items, connections }) {
  SC.applyingRemote = true;
  S.items = items || S.items;
  S.connections = connections || S.connections;
  S.selId = null; S.selIds = []; S.selIsCopy = false; S.selConnId = null;
  if (_origRenderCanvas) _origRenderCanvas.call(window);
  _reattachCursorsLayer();
  if (typeof renderDom === 'function') renderDom();
  if (typeof updAnimBtn === 'function') updAnimBtn();
  SC.applyingRemote = false;
}

// ── Broadcast / Apply CSS ────────────────────────────────────
window.broadcastCss = function (elId, css, isCopy, connId) {
  const ch = SC.liveMode ? SC.channel : (SC.watchMode ? SC.watchChannel : null);
  if (!ch) return;
  ch.send({
    type: 'broadcast', event: 'css_change',
    payload: { elId, css, isCopy, connId }
  });
};

function applyRemoteCss({ elId, css, isCopy, connId }) {
  if (isCopy) {
    const conn = S.connections.find(c => c.id === connId);
    const cp = conn?.copies.find(c => c.id === elId);
    if (cp) { cp.css = css; const el = document.getElementById(elId); if (el) el.style.cssText = css; }
  } else {
    const it = S.items.find(i => i.id === elId);
    if (it) { it.css = css; const el = document.getElementById(elId); if (el) el.style.cssText = css; }
  }
}

// ── Remote cursor rendering ───────────────────────────────────
function updateRemoteCursor({ uid, name, color, av, x, y, note }) {
  if (uid === SC.user?.id) return;
  const layer = document.getElementById('cursors-layer');
  if (!layer) return;
  let cur = SC.liveCursors[uid];
  if (!cur) {
    cur = document.createElement('div');
    cur.style.cssText = 'position:absolute;pointer-events:none;z-index:201;transition:left .06s linear,top .06s linear;';
    cur.innerHTML = `
      <svg width="14" height="20" viewBox="0 0 14 20" style="display:block;">
        <path d="M1 1 L1 16 L5 12 L8 19 L10 18 L7 11 L13 11 Z" fill="${color}" stroke="#fff" stroke-width="1"/>
      </svg>
      <div style="background:${color};color:#fff;font-size:9px;font-weight:700;padding:1px 6px;
        border-radius:8px;margin-top:1px;white-space:nowrap;">${av} ${name}</div>`;
    layer.appendChild(cur);
    SC.liveCursors[uid] = cur;
  }
  cur.style.left = x + 'px';
  cur.style.top = y + 'px';
  // Update or remove floating note for this cursor
  const prevNote = SC.notes[uid]?.text || null;
  if (note !== undefined && note !== prevNote) {
    if (note) {
      SC.notes[uid] = { text: note };
      showNoteOnCanvas(uid, name, color, av, x + 16, y, note);
    } else {
      delete SC.notes[uid];
      document.getElementById('note_' + uid)?.remove();
    }
  } else if (note && SC.notes[uid]) {
    // Move note with cursor
    const nb = document.getElementById('note_' + uid);
    if (nb) { nb.style.left = (x + 16) + 'px'; nb.style.top = y + 'px'; }
  }
}

function clearRemoteCursors() {
  const layer = document.getElementById('cursors-layer');
  if (layer) layer.innerHTML = '';
  SC.liveCursors = {};
}

function renderOnlineUsers(state) {
  const container = document.getElementById('online-users');
  if (!container) return;
  container.innerHTML = Object.values(state).flat().map(u =>
    `<span title="${u.user}" style="background:${u.color || '#8b5cf6'};color:#fff;
      padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;margin-left:3px;">
      ${u.av || (u.user || '?').slice(0, 2)}</span>`
  ).join('');
}

function updateLiveUI(mode, label) {
  const btn = document.getElementById('live-btn');
  const status = document.getElementById('live-status');
  const copyBtn = document.getElementById('copy-local-btn');
  if (mode === 'live') {
    if (btn) { btn.style.background = '#22c55e'; btn.style.color = '#fff'; btn.textContent = '● LIVE'; btn.title = 'Остановить Live'; btn.onclick = () => toggleLiveSession(); }
    if (status) { status.textContent = label; status.style.color = '#22c55e'; }
    if (copyBtn) copyBtn.style.display = 'none';
  } else if (mode === 'watch') {
    if (btn) { btn.style.background = '#3b82f6'; btn.style.color = '#fff'; btn.textContent = '✏️ ' + label; btn.title = 'Совместное редактирование. Клик — выйти'; }
    if (status) { status.textContent = ''; }
    if (copyBtn) copyBtn.style.display = '';
    btn && (btn.onclick = async () => { await stopWatching(); btn.onclick = () => toggleLiveSession(); });
  } else {
    if (btn) { btn.style.background = ''; btn.style.color = ''; btn.textContent = '⚡ Live'; btn.title = 'Запустить Live'; btn.onclick = () => toggleLiveSession(); }
    if (status) { status.textContent = ''; }
    if (copyBtn) copyBtn.style.display = 'none';
  }
  renderUserBadge();
  renderContextBar();
}

// ════════════════════════════════════════════════════════════════
// NOTE SYSTEM (e + Enter)
// ════════════════════════════════════════════════════════════════

function openNoteOverlay() {
  const overlay = document.getElementById('note-overlay');
  const wrap = document.getElementById('note-input-wrap');
  const textarea = document.getElementById('note-textarea');
  if (!overlay) return;
  // Position near cursor (screen coordinates)
  const scr = SC.lastMouseScr || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let left = Math.min(scr.x + 16, window.innerWidth - 390);
  let top = Math.min(scr.y - 20, window.innerHeight - 260);
  wrap.style.left = left + 'px';
  wrap.style.top = top + 'px';
  textarea.value = '';
  const cnt = document.getElementById('note-word-count');
  if (cnt) cnt.textContent = '0 слов';
  overlay.style.display = '';
  setTimeout(() => textarea.focus(), 30);
}

window.submitNote = function () {
  const textarea = document.getElementById('note-textarea');
  const text = textarea?.value?.trim();
  if (!text) { cancelNote(); return; }
  document.getElementById('note-overlay').style.display = 'none';
  if (!SC.user) return;
  const cx = SC.lastCursorX;
  const cy = SC.lastCursorY;
  SC.notes[SC.user.id] = { x: cx, y: cy, text };
  showNoteOnCanvas(SC.user.id, SC.user.name, SC.user.color, SC.user.av, cx + 16, cy, text, true);
  // Broadcast
  const ch = SC.liveMode ? SC.channel : (SC.watchMode ? SC.watchChannel : null);
  if (ch) {
    ch.send({
      type: 'broadcast', event: 'note_update',
      payload: { uid: SC.user.id, name: SC.user.name, color: SC.user.color, av: SC.user.av, x: cx + 16, y: cy, text }
    });
  }
};

window.cancelNote = function () {
  document.getElementById('note-overlay').style.display = 'none';
};

window.removeMyNote = function () {
  if (!SC.user) return;
  delete SC.notes[SC.user.id];
  document.getElementById('note_' + SC.user.id)?.remove();
  // Broadcast removal (empty text = remove)
  const ch = SC.liveMode ? SC.channel : (SC.watchMode ? SC.watchChannel : null);
  if (ch) {
    ch.send({
      type: 'broadcast', event: 'note_update',
      payload: { uid: SC.user.id, name: SC.user.name, color: SC.user.color, av: SC.user.av, x: 0, y: 0, text: '' }
    });
  }
};

function showNoteOnCanvas(uid, name, color, av, x, y, text, isMine) {
  const layer = document.getElementById('cursors-layer');
  if (!layer) return;
  document.getElementById('note_' + uid)?.remove();
  if (!text) return;
  const div = document.createElement('div');
  div.id = 'note_' + uid;
  div.style.cssText = `position:absolute;left:${x}px;top:${y}px;pointer-events:${isMine ? 'auto' : 'none'};z-index:202;`;
  div.innerHTML = `
    <div style="background:${color};color:#fff;border-radius:0 9px 9px 9px;padding:6px 10px;
      max-width:200px;box-shadow:0 3px 10px rgba(0,0,0,.22);font-size:11px;line-height:1.5;">
      <div style="font-size:9px;font-weight:700;margin-bottom:3px;display:flex;justify-content:space-between;align-items:center;">
        <span>${av} ${name}</span>
        ${isMine ? `<span onclick="removeMyNote()" style="cursor:pointer;opacity:.75;margin-left:8px;font-size:11px;" title="Удалить заметку">✕</span>` : ''}
      </div>
      <div>${text}</div>
    </div>`;
  layer.appendChild(div);
}

// ════════════════════════════════════════════════════════════════
// CONTEXT BAR & COPY HOST LOCALLY
// ════════════════════════════════════════════════════════════════

function renderContextBar() {
  const ctxLocal = document.getElementById('ctx-local');
  const ctxGlobal = document.getElementById('ctx-global');
  if (!ctxLocal) return;
  if (!SC.user) { ctxLocal.textContent = '—'; ctxGlobal.textContent = ''; return; }

  // Line 1: who + collab indicator
  let who = SC.user.av + ' ' + SC.user.name;
  if (SC.watchMode && SC.watchTarget) {
    const host = TEAM_USERS.find(x => x.id === SC.watchTarget);
    who += (SC.watchReadOnly ? '  👁 ' : '  ✏️ ') + (host?.name || SC.watchTarget);
  } else if (SC.liveMode) {
    who += '  📡 LIVE';
  }
  ctxLocal.textContent = who;

  // Line 2: working version + global latest
  let versionLine = '';
  if (SC.workingMode === 'central' && SC.currentInstanceId) {
    const m = SC.currentInstanceId.match(/_экземпляр_(\d+)$/);
    versionLine = '🌐 центр.' + (m ? ' экз. ' + m[1] : ' ' + SC.currentInstanceId);
  } else if (SC.workingMode === 'local' && SC.currentLocalSave) {
    const short = SC.currentLocalSave.length > 22 ? SC.currentLocalSave.slice(0, 20) + '…' : SC.currentLocalSave;
    versionLine = '💾 ' + short;
  } else if (SC.projectBase) {
    versionLine = '📁 ' + SC.projectBase;
  } else {
    versionLine = '― черновик';
  }
  ctxGlobal.textContent = versionLine;

  // Append latest global instance info (async, low priority)
  if (SC.client && SC.projectBase) {
    SC.client.from('projects')
      .select('id').ilike('id', SC.projectBase + '_экземпляр_%')
      .not('id', 'ilike', 'live_%')
      .order('id', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (!data?.[0]) return;
        const m = data[0].id.match(/_экземпляр_(\d+)$/);
        const latest = m ? 'экз. ' + m[1] : data[0].id;
        if (ctxGlobal.textContent && !ctxGlobal.textContent.includes('→'))
          ctxGlobal.textContent += ' → глоб. ' + latest;
      });
  }
}

// Copy the host's current live state to MY localStorage
window.copyHostLocally = async function () {
  if (!SC.watchTarget || !SC.client) { cloudToast('Сначала начните наблюдение', 'warn'); return; }
  const { data } = await SC.client.from('projects')
    .select('data').eq('id', 'live_' + SC.watchTarget).single();
  if (!data?.data) { cloudToast('Нет данных от хоста', 'error'); return; }
  const u = TEAM_USERS.find(x => x.id === SC.watchTarget);
  const name = (SC.projectBase || 'project') + '_копия_' + (u?.name || SC.watchTarget) + '_' + new Date().toISOString().slice(0, 10);
  const saves = JSON.parse(localStorage.getItem('cg_local_saves') || '[]');
  saves.unshift({ id: name.replace(/\s+/g, '_'), name, ts: Date.now(), data: data.data });
  localStorage.setItem('cg_local_saves', JSON.stringify(saves.slice(0, 10)));
  cloudToast('📋 Скопировано: ' + name, 'success');
};

// ════════════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════════════
function cloudToast(msg, type = 'info') {
  let t = document.getElementById('cloud-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'cloud-toast';
    t.style.cssText = 'position:fixed;bottom:260px;right:18px;z-index:9999;padding:9px 16px;border-radius:8px;font-size:12px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,.18);transition:opacity .3s,transform .3s;max-width:300px;pointer-events:none;';
    document.body.appendChild(t);
  }
  const bg = { success: '#22c55e', error: '#ef4444', warn: '#f59e0b', info: '#3b82f6' };
  t.style.background = bg[type] || bg.info;
  t.style.color = '#fff'; t.textContent = msg;
  t.style.opacity = '1'; t.style.transform = 'translateY(0)';
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(12px)'; }, 3500);
}
