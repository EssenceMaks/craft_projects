'use strict';
// ════════════════════════════════════════════════════════════════
// WORKSPACE ENGINE — Integration layer
// Runs AFTER bubble engine (workspace_engine.js) + supabase-config.js
// Provides: auth, cloud save/load, live sessions, CG panel management
// ════════════════════════════════════════════════════════════════

const SC = window.SC = {
  client: null, user: null, projectBase: null,
  workingMode: null, currentInstanceId: null, currentLocalSave: null,
  channel: null, watchChannel: null, globalChannel: null,
  liveMode: false, watchMode: false, watchReadOnly: false, watchTarget: null,
  liveCursors: {}, notes: {},
  noteMode: false, noteModeTimer: null,
  lastCursorX: 0, lastCursorY: 0, lastMouseScr: null,
  cursorThrottle: null, broadcastTimer: null, liveAutoTimer: null,
  loginSelected: null, modalRefreshTimer: null, _switchingUser: false,
  activeCgBubbleId: null
};

// ── INIT ───────────────────────────────────────────────────────
window.initWorkspace = function () {
  // Hook CG items into bubble right-click menu
  window._cgContextMenuHook = (bubbleId, ctxEl) => {
    const sep = document.createElement('div'); sep.className = 'ctx-sep'; ctxEl.appendChild(sep);
    const btn = document.createElement('div'); btn.className = 'ctx-btn accent';
    btn.textContent = '🧩 Создать окна CG';
    btn.onclick = ev => { ev.stopPropagation(); ctxEl.style.display = 'none'; createCGWindows(bubbleId); };
    ctxEl.appendChild(btn);
  };

  // Cloud/Supabase init
  if (typeof supabase !== 'undefined' && typeof SUPA_URL !== 'undefined') {
    try { SC.client = supabase.createClient(SUPA_URL, SUPA_KEY); } catch (e) { console.warn('[WS] Supabase init failed:', e); }
  }

  // Cursor tracking for live broadcasts
  document.getElementById('pixi-canvas')?.addEventListener('mousemove', e => {
    if (!SC.user) return;
    const wc = window.worldContainer; if (!wc) return;
    SC.lastCursorX = Math.round((e.clientX - wc.x) / wc.scale.x);
    SC.lastCursorY = Math.round((e.clientY - wc.y) / wc.scale.y);
    SC.lastMouseScr = { x: e.clientX, y: e.clientY };
    const ch = SC.liveMode ? SC.channel : (SC.watchMode ? SC.watchChannel : null);
    if (!ch) return;
    if (SC.cursorThrottle) return;
    SC.cursorThrottle = setTimeout(() => { SC.cursorThrottle = null; }, 50);
    ch.send({ type: 'broadcast', event: 'cursor', payload: { uid: SC.user.id, name: SC.user.name, color: SC.user.color, av: SC.user.av, x: SC.lastCursorX, y: SC.lastCursorY, pb: SC.projectBase || 'default' } });
  });

  // E+Enter note system
  document.addEventListener('keydown', _noteKeyHandler);
  document.getElementById('note-textarea')?.addEventListener('input', e => {
    const w = e.target.value.trim().split(/\s+/).filter(Boolean).length;
    const el = document.getElementById('note-word-count'); if (el) el.textContent = w + ' слов';
  });

  // Draft autosave every 30s (quick recovery)
  setInterval(() => {
    try { localStorage.setItem('ws_draft', JSON.stringify({ snapshot: _getSnap(), projectBase: SC.projectBase, ts: Date.now() })); } catch (e) { }
  }, 30000);
  // Versioned autosave every 5 min
  setInterval(_autoSave, 300000);

  buildLoginModal();
  _restoreSession();
};

// ── AUTH ───────────────────────────────────────────────────────
function _restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem('ws_user') || 'null');
    if (saved?.id) {
      SC.user = saved;
      window._bubbleSetUser && window._bubbleSetUser(saved);
      renderUserBadge();
      // Restore theme and background style for this user
      typeof window._loadSavedTheme === 'function' && window._loadSavedTheme();
      typeof window._loadSavedBgStyle === 'function' && window._loadSavedBgStyle();
      setTimeout(_joinGlobalChannel, 800);
      _restoreDraft(); return;
    }
  } catch (e) { }
  showLoginModal();
}

window.showLoginModal = function () {
  const m = document.getElementById('ws-login-modal'); if (!m) return;
  buildLoginModal(); m.classList.remove('hidden');
  const cb = document.getElementById('login-modal-close'); if (cb) cb.style.display = SC.user ? '' : 'none';
};
window.closeLoginModal = function () {
  document.getElementById('ws-login-modal')?.classList.add('hidden');
  SC._switchingUser = false; SC.loginSelected = null;
  document.querySelectorAll('.login-user-card').forEach(c => c.classList.remove('sel'));
  const lp = document.getElementById('login-pass'); if (lp) lp.value = '';
};

function buildLoginModal() {
  const list = document.getElementById('login-user-list'); if (!list) return;
  list.innerHTML = TEAM_USERS.map(u => {
    const isCur = SC.user?.id === u.id;
    return `<div class="login-user-card" data-uid="${u.id}"
      style="border-left:4px solid ${u.color};${isCur ? 'opacity:.4;pointer-events:none;' : ''}"
      onclick="selectLoginUser('${u.id}')">
      <span class="login-av" style="background:${u.color};">${u.av}</span>
      <span style="font-weight:700;">${u.name}</span>
      ${isCur ? '<span style="font-size:9px;color:#7a8599;margin-left:auto;">✓ текущий</span>' : ''}
    </div>`;
  }).join('');
  const t = document.getElementById('login-modal-title');
  if (t) t.childNodes[0].textContent = SC._switchingUser ? '🔄 Сменить' : '👤 Войти';
}

window.selectLoginUser = function (uid) {
  SC.loginSelected = uid;
  document.querySelectorAll('.login-user-card').forEach(c => c.classList.toggle('sel', c.dataset.uid === uid));
  document.getElementById('login-pass')?.focus();
};

window.doLogin = function () {
  const uid = SC.loginSelected, pass = document.getElementById('login-pass')?.value || '';
  if (!uid) { wsToast('Выберите пользователя', 'warn'); return; }
  const u = TEAM_USERS.find(x => x.id === uid);
  if (!u || u.pass !== pass) { wsToast('Неверный пароль!', 'error'); return; }
  SC.user = { id: u.id, name: u.name, color: u.color, av: u.av };
  localStorage.setItem('ws_user', JSON.stringify(SC.user));
  window._bubbleSetUser && window._bubbleSetUser(SC.user);
  renderUserBadge(); closeLoginModal();
  // Apply saved theme and background style for this user
  typeof window._loadSavedTheme === 'function' && window._loadSavedTheme();
  typeof window._loadSavedBgStyle === 'function' && window._loadSavedBgStyle();
  wsToast('Привет, ' + u.name + '! 👋', 'success');
  _restoreDraft();
  // Re-join global channel after brief delay (allows Supabase client to settle)
  setTimeout(_joinGlobalChannel, 500);
};

window.showAccountPanel = function () {
  const panel = document.getElementById('account-panel');
  if (!panel) return;
  if (panel.classList.contains('visible')) { closeAccountPanel(); return; }
  if (!SC.user) { showLoginModal(); return; }
  _renderAccountPanel();
  panel.classList.add('visible');
  setTimeout(() => document.addEventListener('pointerdown', _apClose, { once: true }), 60);
};
function _apClose(e) {
  const panel = document.getElementById('account-panel');
  if (!panel) return;
  if (!panel.contains(e.target) && e.target.id !== 'cb-user-btn' && !e.target.closest('#cb-user-btn'))
    closeAccountPanel();
}
window.closeAccountPanel = function () {
  document.getElementById('account-panel')?.classList.remove('visible');
  document.removeEventListener('pointerdown', _apClose);
};
function _renderAccountPanel() {
  const panel = document.getElementById('account-panel');
  if (!panel || !SC.user) return;
  const u = SC.user;
  const curTheme = localStorage.getItem('ws_theme_' + u.id) || 'void';
  const curBg = localStorage.getItem('ws_bg_' + u.id) || 'none';
  const themes = window.WS_THEMES || [];
  const bgStyles = window.WS_BG_STYLES || [];
  const statusHtml = SC.liveMode
    ? '<span style="color:#22c55e;font-weight:700;">● LIVE</span>'
    : SC.watchMode
      ? '<span style="color:#3b82f6;font-weight:700;">' + (SC.watchReadOnly ? '👁 Наблюд.' : '✏️ Совм.') + '</span>'
      : '';
  const projectHtml = SC.workingMode === 'central' && SC.currentInstanceId
    ? '🌐 ' + SC.currentInstanceId
    : SC.workingMode === 'local' && SC.currentLocalSave
      ? '💾 ' + SC.currentLocalSave
      : SC.projectBase ? '📁 ' + SC.projectBase : '― черновик';
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2px;">
      <div class="acc-user-row" style="margin-bottom:0;">
        <div class="acc-av" style="background:${u.color}">${u.av}</div>
        <div><div class="acc-name">${u.name}</div><div class="acc-id">@${u.id}</div></div>
      </div>
      <span onclick="closeAccountPanel()" style="cursor:pointer;color:var(--mu,#7a8599);font-size:18px;line-height:1;padding:2px 4px;">×</span>
    </div>
    <div class="acc-status">${statusHtml}${statusHtml ? ' · ' : ''}${projectHtml}</div>
    <div class="acc-sep"></div>
    <div class="acc-section-label">Тема</div>
    <div class="acc-theme-row">
      ${themes.map(t => `<span class="acc-theme-dot${curTheme === t.id ? ' active' : ''}"
        title="${t.label}" style="background:${t.dot}"
        onclick="window.applyTheme('${t.id}');_renderAccountPanel()"></span>`).join('')}
    </div>
    <div class="acc-section-label" style="margin-top:8px;">Фон холста</div>
    <div class="acc-bg-row">
      ${bgStyles.map(s => `<span class="acc-bg-btn${curBg === s.id ? ' active' : ''}"
        onclick="window.applyBgStyle('${s.id}');_renderAccountPanel()">${s.label}</span>`).join('')}
    </div>
    <div class="acc-sep"></div>
    <div class="acc-item" onclick="approveLocal();closeAccountPanel()">
      <span>💾</span> Сохранить локально
    </div>
    <div class="acc-item" onclick="pushToCenter();closeAccountPanel()">
      <span>📤</span> Сохранить в облако
    </div>
    <div class="acc-item" onclick="showCloudModal();closeAccountPanel()">
      <span>🗂</span> Проекты и Live
    </div>
    <div class="acc-sep"></div>
    <div class="acc-item" onclick="_switchAccount()">
      <span>🔄</span> Сменить пользователя
    </div>
    <div class="acc-item danger" onclick="_confirmLogout()">
      <span>→</span> Выйти
    </div>`;
}
window._switchAccount = function () {
  closeAccountPanel();
  if ((SC.liveMode || SC.watchMode) && !confirm('Вы в активной сессии. Продолжить?')) return;
  if (SC.liveMode) stopLiveSession(); if (SC.watchMode) _stopWatching();
  SC._switchingUser = true; showLoginModal();
};
window._confirmLogout = function () {
  closeAccountPanel();
  if ((SC.liveMode || SC.watchMode) && !confirm('Выйти из активной сессии?')) return;
  if (SC.liveMode) stopLiveSession();
  if (SC.watchMode) _stopWatching();
  // Unsubscribe global channel so next user can join fresh
  if (SC.globalChannel) {
    try { SC.globalChannel.unsubscribe(); } catch (e) { }
    SC.globalChannel = null;
  }
  SC.user = null; localStorage.removeItem('ws_user');
  window._bubbleSetUser && window._bubbleSetUser(null);
  renderUserBadge(); showLoginModal();
  wsToast('Вы вышли из аккаунта', 'info');
};

function renderUserBadge() {
  // Update legacy #user-badge if present
  const b = document.getElementById('user-badge');
  if (b) {
    b.innerHTML = SC.user
      ? `<span style="background:${SC.user.color};color:#fff;padding:3px 9px;border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;" onclick="showAccountPanel()">${SC.user.av} ${SC.user.name}</span>`
      : `<button class="cb-btn" onclick="showLoginModal()">Войти</button>`;
  }
  // Update new cloud-bar user elements
  const cbAv = document.getElementById('cb-user-av');
  const cbName = document.getElementById('cb-user-name');
  if (cbAv && cbName) {
    if (SC.user) {
      cbAv.textContent = SC.user.av;
      cbAv.style.background = SC.user.color;
      cbName.textContent = SC.user.name;
    } else {
      cbAv.textContent = '?';
      cbAv.style.background = 'var(--mu,#7a8599)';
      cbName.textContent = 'Войти';
    }
  }
  _renderContextBar();
}

function _renderContextBar() {
  const cL = document.getElementById('ctx-local');
  const cPN = document.getElementById('cb-project-name');
  const cG = document.getElementById('ctx-global');

  if (!SC.user) {
    if (cL) cL.textContent = '\u2014';
    if (cPN) cPN.textContent = '\u2014 \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a';
    if (cG) cG.textContent = '';
    return;
  }

  // Project name line (cb-project-name): base + instance shorthand
  const base = SC.projectBase || 'draft';
  const modeIcon = SC.workingMode === 'central' ? '\ud83c\udf10' : SC.workingMode === 'local' ? '\ud83d\udcbe' : '\ud83d\udcc1';
  const projText = modeIcon + ' ' + base + (SC.currentInstanceId ? ' \u00b7 #' + (SC.currentInstanceId.match(/_(\d+)$/) || ['', '?'])[1] : '');
  if (cPN) cPN.textContent = SC.projectBase ? projText : '\u2015 \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a';
  if (cL) cL.textContent = SC.projectBase ? projText : '\u2015 \u0447\u0435\u0440\u043d\u043e\u0432\u0438\u043a';

  // Second line (ctx-global): mode status
  let modeStr = '';
  if (SC.liveMode) {
    modeStr = '\u25cf LIVE';
  } else if (SC.watchMode && SC.watchTarget) {
    const h = TEAM_USERS.find(x => x.id === SC.watchTarget);
    modeStr = (SC.watchReadOnly ? '\ud83d\udc41 ' : '\u270f\ufe0f ') + (h?.name || SC.watchTarget);
  }
  if (cG) cG.textContent = modeStr;
}

// ── SNAPSHOT HELPERS ───────────────────────────────────────────
function _getSnap() {
  const wc = window.worldContainer;
  return { state: window.getBubbleState(), camera: wc ? { x: wc.x, y: wc.y, scale: wc.scale.x } : { x: 0, y: 0, scale: 1 }, pb: SC.projectBase || null };
}
function _applySnap(snap) {
  if (!snap?.state) return;
  if (snap.pb) SC.projectBase = snap.pb;
  window.setBubbleState(snap.state);
  if (snap.camera && window.worldContainer) { window.worldContainer.x = snap.camera.x; window.worldContainer.y = snap.camera.y; window.worldContainer.scale.set(snap.camera.scale); }
  window.fullRebuild && window.fullRebuild();
  window.clearBubblePartSys && window.clearBubblePartSys();
  window.syncGPUI && window.syncGPUI();
  window.selectEntity && window.selectEntity(null, null);
  window.queueRender && window.queueRender();
  // Restore CG window layout for observers
  setTimeout(() => { window.restoreCGFromState && window.restoreCGFromState(); }, 200);
}
function _restoreDraft() {
  try {
    const d = JSON.parse(localStorage.getItem('ws_draft') || 'null');
    if (!d?.snapshot?.state) return;
    _applySnap(d.snapshot);
    if (d.projectBase) SC.projectBase = d.projectBase;
    _renderContextBar(); wsToast('Черновик восстановлен', 'info');
  } catch (e) { }
}

// ── VERSIONED SAVE SYSTEM ─────────────────────────────────────
function _autoSave() {
  if (!SC.user) return;
  const key = 'ws_autosave_' + SC.user.id;
  try {
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    arr.unshift({ ts: Date.now(), pb: SC.projectBase || 'default', instanceId: SC.currentInstanceId || null, snap: _getSnap() });
    localStorage.setItem(key, JSON.stringify(arr.slice(0, 20)));
  } catch (e) { }
}
function _getAutoSaves() {
  if (!SC.user) return [];
  try { return JSON.parse(localStorage.getItem('ws_autosave_' + SC.user.id) || '[]'); } catch (e) { return []; }
}
function _getApproved() {
  if (!SC.user) return [];
  const key = 'ws_approved_' + SC.user.id;
  try {
    let arr = JSON.parse(localStorage.getItem(key) || '[]');
    // One-time migration from legacy ws_local_saves
    const legacyKey = 'ws_local_saves';
    const legacy = JSON.parse(localStorage.getItem(legacyKey) || '[]');
    if (legacy.length && !localStorage.getItem('ws_legacy_migrated_' + SC.user.id)) {
      const migrated = legacy.map(s => ({ id: 'appr_legacy_' + s.id, name: s.name, ts: s.ts || Date.now(), pb: SC.projectBase || 'default', instanceId: null, snap: { state: s.state, camera: s.camera || { x: 0, y: 0, scale: 1 } }, autosaves: [] }));
      arr = [...arr, ...migrated];
      localStorage.setItem(key, JSON.stringify(arr.slice(0, 30)));
      localStorage.setItem('ws_legacy_migrated_' + SC.user.id, '1');
    }
    return arr;
  } catch (e) { return []; }
}
window.approveLocal = function () {
  if (!SC.user) { showLoginModal(); return; }
  const nameEl = document.getElementById('local-save-name');
  const pb = SC.projectBase || 'default';
  const autoName = pb + '_апруд_' + new Date().toLocaleString('ru', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
  const name = (nameEl?.value || '').trim() || autoName;
  const auto = _getAutoSaves().filter(a => a.pb === pb).slice(0, 5);
  const appr = _getApproved();
  const entry = { id: 'appr_' + Date.now(), name, ts: Date.now(), pb, instanceId: SC.currentInstanceId || null, snap: _getSnap(), autosaves: auto };
  appr.unshift(entry);
  localStorage.setItem('ws_approved_' + SC.user.id, JSON.stringify(appr.slice(0, 30)));
  SC.currentLocalSave = name; SC.workingMode = 'local';
  if (nameEl) nameEl.value = '';
  wsToast('✅ Апруд: ' + name, 'success'); _renderContextBar(); refreshCloudModal();
};
window.loadLocalSave = function (id) {
  const appr = _getApproved(); const s = appr.find(x => x.id === id); if (!s?.snap) return;
  _applySnap(s.snap); SC.currentLocalSave = s.name; SC.workingMode = 'local';
  wsToast('💾 Загружено: ' + s.name, 'success'); _renderContextBar(); closeCloudModal();
};
window.loadAutoSave = function (idx) {
  const arr = _getAutoSaves(); const s = arr[idx]; if (!s?.snap) return;
  _applySnap(s.snap); SC.workingMode = 'local';
  wsToast('🔄 Автосейв загружен (' + new Date(s.ts).toLocaleTimeString('ru') + ')', 'info'); closeCloudModal();
};
window.deleteApproved = function (id) {
  if (!SC.user || !confirm('Удалить?')) return;
  const appr = _getApproved().filter(x => x.id !== id);
  localStorage.setItem('ws_approved_' + SC.user.id, JSON.stringify(appr)); refreshCloudModal();
};
window.pushToCenter = async function (customName) {
  if (!SC.client) { wsToast('Supabase не настроен', 'warn'); return; }
  if (!SC.user) { showLoginModal(); return; }
  const base = customName || (document.getElementById('cloud-project-name')?.value || '').trim() || SC.projectBase || 'workspace_1';
  SC.projectBase = base;
  const { data: ex } = await SC.client.from('projects').select('id').ilike('id', base + '_экземпляр_%').not('id', 'ilike', 'live_%').order('id', { ascending: false }).limit(1);
  let n = 1; if (ex?.[0]) { const m = ex[0].id.match(/_экземпляр_(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  const newId = base + '_экземпляр_' + n;
  const { error } = await SC.client.from('projects').upsert({ id: newId, name: newId, data: _getSnap(), owner: SC.user.id, live: false, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) { wsToast('Ошибка: ' + error.message, 'error'); return; }
  SC.currentInstanceId = newId; SC.workingMode = 'central';
  wsToast('📤 Сохранено: ' + newId, 'success'); _renderContextBar();
};
window.loadInstance = async function (id) {
  if (!SC.client) return;
  if (SC.liveMode) stopLiveSession();
  if (SC.watchMode) _stopWatching();
  const { data } = await SC.client.from('projects').select('data').eq('id', id).single();
  if (!data?.data) { wsToast('Нет данных', 'error'); return; }
  _applySnap(data.data);
  const m = id.match(/^(.+)_экземпляр_/); if (m) SC.projectBase = m[1];
  SC.currentInstanceId = id; SC.workingMode = 'central';
  wsToast('⬇ Загружено: ' + id, 'success'); _renderContextBar(); closeCloudModal();
};
window.deleteInstance = async function (id) {
  if (!SC.client || !confirm('Удалить ' + id + '?')) return;
  await SC.client.from('projects').delete().eq('id', id);
  wsToast('Удалено: ' + id, 'info'); refreshCloudModal();
};
window.copyHostLocally = async function () {
  if (!SC.watchTarget || !SC.client) { wsToast('Сначала начните наблюдение', 'warn'); return; }
  if (!SC.user) { showLoginModal(); return; }
  const { data } = await SC.client.from('projects').select('data').eq('id', 'live_' + SC.watchTarget).single();
  if (!data?.data) { wsToast('Нет данных', 'error'); return; }
  const u = TEAM_USERS.find(x => x.id === SC.watchTarget);
  const name = (SC.projectBase || 'default') + '_копия_' + (u?.name || SC.watchTarget);
  const appr = _getApproved();
  appr.unshift({ id: 'appr_' + Date.now(), name, ts: Date.now(), pb: SC.projectBase || 'default', instanceId: null, snap: data.data, autosaves: [] });
  localStorage.setItem('ws_approved_' + SC.user.id, JSON.stringify(appr.slice(0, 30)));
  wsToast('📋 Скопировано: ' + name, 'success');
};

// ── CLOUD MODAL ────────────────────────────────────────────────
window.showCloudModal = async function () {
  const m = document.getElementById('ws-cloud-modal'); if (!m) return;
  m.classList.remove('hidden'); await refreshCloudModal();
  SC.modalRefreshTimer = setInterval(() => { if (!m.classList.contains('hidden')) refreshCloudModal(); else { clearInterval(SC.modalRefreshTimer); } }, 20000);
};
window.closeCloudModal = function () {
  document.getElementById('ws-cloud-modal')?.classList.add('hidden');
  clearInterval(SC.modalRefreshTimer);
};
window.switchCloudTab = function (tab) {
  ['central', 'local'].forEach(t => { document.getElementById('ctab-' + t)?.classList.toggle('on', t === tab); const p = document.getElementById('ctab-' + t + '-panel'); if (p) p.style.display = t === tab ? '' : 'none'; });
};
window.refreshCloudModal = async function () {
  const fmt = ts => new Date(ts).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  // ── Live users bar ──────────────────────────────────────────
  let liveBarH = '';
  if (SC.client) {
    const { data: lr } = await SC.client.from('projects').select('id,owner,version_label').eq('live', true).ilike('id', 'live_%');
    (lr || []).forEach(p => {
      const uid = p.id.replace('live_', ''), u = TEAM_USERS.find(x => x.id === uid), isSelf = SC.user?.id === uid;
      const col = u?.color || '#555', nm = u?.name || uid, av = u?.av || nm[0] || '?', vl = p.version_label || '—';
      liveBarH += `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border:1.5px solid ${col}44;border-radius:8px;margin-bottom:6px;background:${col}11;">
        <span style="background:${col};color:#fff;padding:2px 9px;border-radius:10px;font-size:10px;font-weight:700;">● ${av}</span>
        <span style="flex:1;font-size:12px;font-weight:700;">${nm}</span>
        <span style="font-size:10px;color:#7a8599;">📁 ${vl}</span>
        ${isSelf ? '<span style="font-size:10px;color:#7a8599;font-style:italic;">это вы</span>' : `<button class="ws-btn ws-btn-s" style="font-size:10px;padding:2px 7px;" onclick="watchLive('${uid}',true);closeCloudModal();">👁</button><button class="ws-btn ws-btn-p" style="font-size:10px;padding:2px 7px;" onclick="watchLive('${uid}',false);closeCloudModal();">✏️</button>`}
      </div>`;
    });
  }
  const lb = document.getElementById('cloud-live-list');
  if (lb) lb.innerHTML = liveBarH || '<div style="color:#7a8599;font-size:12px;padding:9px;">Нет Live сессий</div>';

  // ── Central tab: git-tree of Supabase instances ─────────────
  const cc = document.getElementById('cloud-central-list');
  if (!SC.client) { if (cc) cc.innerHTML = '<div style="color:#7a8599;font-size:12px;padding:10px;">Supabase не подключён</div>'; }
  else {
    const { data: projs } = await SC.client.from('projects').select('id,owner,updated_at').not('id', 'ilike', 'live_%').order('id', { ascending: false });
    const grp = {}; (projs || []).forEach(p => { const m = p.id.match(/^(.+)_экземпляр_(\d+)$/); const b = m ? m[1] : 'other'; if (!grp[b]) grp[b] = []; grp[b].push({ ...p, num: m ? parseInt(m[2]) : 0 }); });
    let h = ''; Object.entries(grp).sort((a, b) => a[0].localeCompare(b[0])).forEach(([base, items]) => {
      const isCur = base === SC.projectBase;
      h += `<div style="margin-bottom:14px;">
        <div style="font-size:11px;font-weight:800;color:${isCur ? '#00ffcc' : '#8b5cf6'};padding:4px 0;border-bottom:1px solid ${isCur ? 'rgba(0,255,204,.3)' : 'rgba(139,92,246,.2)'};margin-bottom:6px;">
          📁 ${base}${isCur ? ' ← текущий' : ''}
        </div>`;
      items.sort((a, b) => b.num - a.num).forEach(p => {
        const isCurInst = p.id === SC.currentInstanceId;
        h += `<div class="cloud-inst-row" style="${isCurInst ? 'border-left:3px solid #00ffcc;padding-left:8px;' : ''}">
          <div style="flex:1;min-width:0;">
            <span style="font-weight:700;font-size:12px;">Экз.&nbsp;${p.num}</span>
            <span style="font-size:9px;color:#7a8599;margin-left:5px;">${p.owner || ''} · ${p.updated_at?.slice(0, 16) || ''}</span>
            ${isCurInst ? '<span style="font-size:9px;color:#00ffcc;margin-left:4px;">▶ активный</span>' : ''}
          </div>
          <div style="display:flex;gap:4px;">
            <button class="ws-btn ws-btn-s" style="font-size:10px;padding:3px 7px;" onclick="loadInstance('${p.id}')">⬇</button>
            <button class="ws-btn ws-btn-rl" style="font-size:10px;padding:3px 6px;" onclick="deleteInstance('${p.id}')">✕</button>
          </div>
        </div>`;
      });
      h += '</div>';
    });
    if (cc) cc.innerHTML = h || '<div style="color:#7a8599;font-size:12px;padding:10px;">Нет экземпляров</div>';
  }

  // ── Local tab: git-tree of approved saves + auto-saves ───────
  const cl = document.getElementById('cloud-local-list');
  if (cl) {
    const appr = _getApproved(), auto = _getAutoSaves();
    const pb = SC.projectBase || 'default';
    let h = '';
    if (appr.length === 0) {
      // Show only auto-saves if no approved
      const pbAuto = auto.filter(a => a.pb === pb);
      if (pbAuto.length) {
        h += '<div style="font-size:10px;color:#7a8599;margin-bottom:6px;">Нет апрудов — последние автосейвы (' + pb + '):</div>';
        pbAuto.slice(0, 5).forEach((a, i) => {
          h += `<div class="cloud-inst-row" style="padding-left:18px;">
            <div style="flex:1;font-size:10px;color:#7a8599;">🔄 автосейв <span style="font-weight:700;">${fmt(a.ts)}</span></div>
            <button class="ws-btn ws-btn-s" style="font-size:9px;padding:2px 5px;" onclick="loadAutoSave(${auto.indexOf(a)})">↩</button>
          </div>`;
        });
      } else { h = '<div style="color:#7a8599;font-size:12px;padding:9px;">Нет сохранений (нажмите 💾 Апруд)</div>'; }
    } else {
      appr.forEach(a => {
        const isCur = a.id === SC.currentLocalSave || a.name === SC.currentLocalSave;
        const autos = (a.autosaves || []);
        h += `<details style="margin-bottom:7px;" ${isCur ? 'open' : ''}>
          <summary style="cursor:pointer;padding:6px 8px;background:rgba(0,255,204,.07);border:1px solid rgba(0,255,204,.2);border-radius:7px;display:flex;align-items:center;gap:7px;list-style:none;">
            <span style="color:#00ffcc;font-size:12px;">✅</span>
            <span style="flex:1;font-size:11px;font-weight:700;">${a.name}</span>
            <span style="font-size:9px;color:#7a8599;">${fmt(a.ts)} · 📁${a.pb || '—'}</span>
            <button class="ws-btn ws-btn-s" style="font-size:9px;padding:1px 6px;" onclick="event.preventDefault();loadLocalSave('${a.id}')">↩</button>
            <button class="ws-btn ws-btn-rl" style="font-size:9px;padding:1px 5px;" onclick="event.preventDefault();deleteApproved('${a.id}')">✕</button>
          </summary>
          <div style="border-left:2px solid rgba(0,255,204,.15);margin-left:14px;padding-left:8px;margin-top:3px;">
          ${autos.length ? autos.map((as, i) => `<div class="cloud-inst-row" style="padding:3px 0;">
            <div style="flex:1;font-size:9px;color:#7a8599;">🔄 автосейв ${fmt(as.ts)}</div>
            <button class="ws-btn ws-btn-s" style="font-size:9px;padding:1px 4px;" onclick="loadAutoSave(${auto.indexOf(as) >= 0 ? auto.indexOf(as) : i})">↩</button>
          </div>`).join('') : '<div style="font-size:9px;color:#7a8599;padding:3px 0;">нет вложенных автосейвов</div>'}
          </div>
        </details>`;
      });
    }
    cl.innerHTML = h;
  }
};

// ── LIVE SESSIONS ──────────────────────────────────────────────
window.toggleLiveSession = async function () { if (SC.liveMode) await stopLiveSession(); else await startLiveSession(); };

async function startLiveSession() {
  if (!SC.client || !SC.user) { if (!SC.user) showLoginModal(); return; }
  const snap = _getSnap();
  const { error } = await SC.client.from('projects').upsert({ id: 'live_' + SC.user.id, name: 'Live: ' + SC.user.name, data: snap, owner: SC.user.id, live: true, version_label: SC.projectBase || 'черновик', updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) { wsToast('Ошибка Live: ' + error.message, 'error'); return; }
  SC.channel = SC.client.channel('live_ch_' + SC.user.id, { config: { broadcast: { self: false }, presence: { key: SC.user.id } } });
  SC.channel.on('presence', { event: 'sync' }, () => _renderOnlineUsers(SC.channel.presenceState()));
  SC.channel.on('broadcast', { event: 'request_sync' }, () => SC.channel.send({ type: 'broadcast', event: 'full_sync', payload: _getSnap() }));
  SC.channel.on('broadcast', { event: 'canvas_update' }, ({ payload }) => { if (payload.from !== SC.user?.id) _applySnap(payload); });
  SC.channel.on('broadcast', { event: 'cg_update' }, ({ payload }) => { if (payload.from !== SC.user?.id) _applyCGUpdate(payload); });
  SC.channel.on('broadcast', { event: 'cursor' }, ({ payload }) => { if (payload.uid !== SC.user?.id) _updateCursor(payload); });
  SC.channel.on('broadcast', { event: 'note_update' }, ({ payload }) => { if (payload.uid !== SC.user?.id) showNoteOnCanvas(payload.uid, payload.name, payload.color, payload.av, payload.x, payload.y, payload.text); });
  await SC.channel.subscribe(async s => { if (s === 'SUBSCRIBED') await SC.channel.track({ id: SC.user.id, user: SC.user.name, name: SC.user.name, color: SC.user.color, av: SC.user.av, live: true }); });
  SC.liveMode = true; _startLiveAuto(); _updateLiveUI('live', SC.user.name);
  wsToast('● LIVE активен', 'success');
  _globalBroadcast('go_live', { uid: SC.user.id, name: SC.user.name, color: SC.user.color, av: SC.user.av }); _updateGlobalPresence(true);
}
window.stopLiveSession = async function () {
  _stopLiveAuto();
  if (SC.channel) { await SC.channel.unsubscribe(); SC.channel = null; }
  if (SC.client && SC.user) SC.client.from('projects').update({ live: false }).eq('id', 'live_' + SC.user.id);
  _globalBroadcast('go_offline', { uid: SC.user?.id }); _updateGlobalPresence(false);
  SC.liveMode = false; _clearCursors(); _updateLiveUI('off', '');
  document.getElementById('online-users').innerHTML = ''; wsToast('Live остановлен', 'info');
};
window.watchLive = async function (targetId, readOnly) {
  if (!SC.client || !SC.user) return; if (SC.watchMode) await _stopWatching();
  const { data } = await SC.client.from('projects').select('data').eq('id', 'live_' + targetId).single();
  if (data?.data) _applySnap(data.data);
  SC.watchChannel = SC.client.channel('live_ch_' + targetId, { config: { broadcast: { self: false }, presence: { key: SC.user.id } } });
  SC.watchChannel.on('presence', { event: 'sync' }, () => _renderOnlineUsers(SC.watchChannel.presenceState()));
  SC.watchChannel.on('broadcast', { event: 'full_sync' }, ({ payload }) => _applySnap(payload));
  SC.watchChannel.on('broadcast', { event: 'canvas_update' }, ({ payload }) => { if (payload.from !== SC.user?.id) _applySnap(payload); });
  SC.watchChannel.on('broadcast', { event: 'cg_update' }, ({ payload }) => { if (payload.from !== SC.user?.id) _applyCGUpdate(payload); });
  SC.watchChannel.on('broadcast', { event: 'cursor' }, ({ payload }) => { if (payload.uid !== SC.user?.id) _updateCursor(payload); });
  SC.watchChannel.on('broadcast', { event: 'note_update' }, ({ payload }) => { if (payload.uid !== SC.user?.id) showNoteOnCanvas(payload.uid, payload.name, payload.color, payload.av, payload.x, payload.y, payload.text); });
  await SC.watchChannel.subscribe(async s => { if (s === 'SUBSCRIBED') { await SC.watchChannel.track({ id: SC.user.id, user: SC.user.name, name: SC.user.name, color: SC.user.color, av: SC.user.av, live: false }); SC.watchChannel.send({ type: 'broadcast', event: 'request_sync', payload: {} }); } });
  SC.watchMode = true; SC.watchReadOnly = readOnly === true; SC.watchTarget = targetId;
  const u = TEAM_USERS.find(x => x.id === targetId);
  _updateLiveUI('watch', (SC.watchReadOnly ? '👁 ' : '✏️ ') + (u?.name || targetId));
  wsToast((SC.watchReadOnly ? '👁 Наблюдаете за ' : '✏️ Совм. ред. с ') + (u?.name || targetId), 'info');
};
async function _stopWatching() { if (SC.watchChannel) { await SC.watchChannel.unsubscribe(); SC.watchChannel = null; } SC.watchMode = false; SC.watchReadOnly = false; SC.watchTarget = null; _clearCursors(); _updateLiveUI('off', ''); }
function _updateLiveUI(mode, label) {
  const btn = document.getElementById('live-btn'), cb = document.getElementById('copy-local-btn');
  const mtb = document.getElementById('cloud-live-toggle-btn');
  if (mode === 'live') {
    if (btn) { btn.textContent = '● LIVE'; btn.className = 'cb-btn live'; }
    if (cb) cb.style.display = 'none';
    if (mtb) { mtb.textContent = '■ Стоп Live'; mtb.style.background = '#ef4444'; mtb.onclick = () => toggleLiveSession(); }
  } else if (mode === 'watch') {
    if (btn) { btn.textContent = label; btn.className = 'cb-btn watch'; }
    if (cb) cb.style.display = '';
    btn && (btn.onclick = async () => { await _stopWatching(); btn.onclick = () => toggleLiveSession(); });
    if (mtb) { mtb.textContent = '✕ Отключиться'; mtb.style.background = '#f59e0b'; mtb.onclick = async () => { await _stopWatching(); if (mtb) mtb.onclick = () => toggleLiveSession(); }; }
  } else {
    if (btn) { btn.textContent = '⚡ Live'; btn.className = 'cb-btn'; btn.onclick = () => toggleLiveSession(); }
    if (cb) cb.style.display = 'none';
    if (mtb) { mtb.textContent = '⚡ Live'; mtb.style.background = ''; mtb.onclick = () => toggleLiveSession(); }
  }
  renderUserBadge();
}
function _startLiveAuto() { SC.liveAutoTimer = setInterval(async () => { if (!SC.liveMode || !SC.client || !SC.user) return; SC.client.from('projects').update({ data: _getSnap(), updated_at: new Date().toISOString() }).eq('id', 'live_' + SC.user.id); }, 30000); }
function _stopLiveAuto() { if (SC.liveAutoTimer) { clearInterval(SC.liveAutoTimer); SC.liveAutoTimer = null; } }

window.broadcastCanvasUpdate = function () {
  const ch = SC.liveMode ? SC.channel : (SC.watchMode && !SC.watchReadOnly ? SC.watchChannel : null);
  if (!ch || !SC.user) return;
  clearTimeout(SC.broadcastTimer);
  SC.broadcastTimer = setTimeout(() => ch.send({ type: 'broadcast', event: 'canvas_update', payload: { ..._getSnap(), from: SC.user.id, pb: SC.projectBase || 'default' } }), 150);
};
window.broadcastCGUpdate = function (bubbleId) {
  const ch = SC.liveMode ? SC.channel : (SC.watchMode && !SC.watchReadOnly ? SC.watchChannel : null);
  if (!ch || !SC.user) return;
  ch.send({ type: 'broadcast', event: 'cg_update', payload: { bubbleId, cgData: window.getBubbleState()?.cgData?.[bubbleId], from: SC.user.id } });
};
function _applyCGUpdate({ bubbleId, cgData }) {
  if (!bubbleId || !cgData) return;
  const st = window.getBubbleState(); if (!st) return;
  if (!st.cgData) st.cgData = {};
  st.cgData[bubbleId] = cgData;
  if (SC.activeCgBubbleId === bubbleId && typeof cgRenderCanvas === 'function') cgRenderCanvas();
}

// ── CURSORS & ONLINE USERS ─────────────────────────────────────
function _updateCursor({ uid, name, color, av, x, y }) {
  if (uid === SC.user?.id) return;
  const wc = window.worldContainer; if (!wc) return;
  const sx = x * wc.scale.x + wc.x, sy = y * wc.scale.y + wc.y;
  let layer = document.getElementById('ws-cursor-layer');
  if (!layer) { // fallback if somehow missing
    layer = document.createElement('div'); layer.id = 'ws-cursor-layer';
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1800;overflow:hidden;';
    document.body.appendChild(layer);
  }
  let cur = SC.liveCursors[uid];
  if (!cur) { cur = document.createElement('div'); cur.style.cssText = 'position:absolute;pointer-events:none;transition:left .06s,top .06s;'; cur.innerHTML = `<svg width="14" height="20" viewBox="0 0 14 20"><path d="M1 1L1 16L5 12L8 19L10 18L7 11L13 11Z" fill="${color}" stroke="#fff" stroke-width="1"/></svg><div style="background:${color};color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:8px;white-space:nowrap;">${av} ${name}</div>`; layer.appendChild(cur); SC.liveCursors[uid] = cur; }
  cur.style.left = sx + 'px'; cur.style.top = sy + 'px';
}
function _clearCursors() {
  const layer = document.getElementById('ws-cursor-layer');
  if (layer) layer.innerHTML = ''; // static element — clear contents, do NOT remove
  SC.liveCursors = {};
}
function _renderOnlineUsers(st) {
  const c = document.getElementById('online-users'); if (!c) return;
  c.innerHTML = Object.values(st).flat()
    .filter(u => u && (u.id || u.user) !== (SC.user?.id || SC.user?.name))
    .map(u => `<div class="ou-av" title="${u.name || u.user || '?'}" style="--user-color:${u.color || '#8b5cf6'};background:${u.color || '#8b5cf6'}">${u.av || (u.name || u.user || '?')[0]}</div>`)
    .join('');
}

// ── GLOBAL CHANNEL ─────────────────────────────────────────────
function _joinGlobalChannel() {
  if (!SC.client || !SC.user) return;
  // Unsubscribe stale channel from a previous user session
  if (SC.globalChannel) {
    try { SC.globalChannel.unsubscribe(); } catch (e) { }
    SC.globalChannel = null;
  }
  const ch = SC.client.channel('cg_global', { config: { broadcast: { self: false }, presence: { key: SC.user.id } } });
  ch.on('presence', { event: 'sync' }, () => { const anyLive = Object.values(ch.presenceState()).flat().some(u => u.live && u.user !== SC.user?.name); _setLiveDot(anyLive); });
  ch.on('broadcast', { event: 'go_live' }, ({ payload }) => { if (payload.uid === SC.user?.id) return; const u = TEAM_USERS.find(x => x.id === payload.uid); wsToast('● ' + (u?.name || payload.uid) + ' начал Live!', 'info'); _setLiveDot(true); if (!document.getElementById('ws-cloud-modal')?.classList.contains('hidden')) refreshCloudModal(); });
  ch.on('broadcast', { event: 'go_offline' }, () => { if (!document.getElementById('ws-cloud-modal')?.classList.contains('hidden')) refreshCloudModal(); setTimeout(() => { if (SC.client) SC.client.from('projects').select('id').eq('live', true).ilike('id', 'live_%').then(({ data }) => _setLiveDot((data || []).length > 0)); }, 2000); });
  ch.subscribe(async s => { if (s === 'SUBSCRIBED') await ch.track({ id: SC.user.id, user: SC.user.name, name: SC.user.name, color: SC.user.color, av: SC.user.av, live: SC.liveMode }); });
  SC.globalChannel = ch;
}
function _globalBroadcast(ev, p) { if (SC.globalChannel) SC.globalChannel.send({ type: 'broadcast', event: ev, payload: p }).catch(() => { }); }
function _updateGlobalPresence(l) { if (SC.globalChannel && SC.user) SC.globalChannel.track({ user: SC.user.name, color: SC.user.color, av: SC.user.av, live: l }).catch(() => { }); }
function _setLiveDot(show) {
  // Use static CSS class toggle approach (element lives in CSS, not created dynamically)
  const dot = document.getElementById('global-live-dot');
  if (dot) { dot.classList.toggle('visible', !!show); return; }
  // Legacy fallback: dynamic creation inside #btn-cloud
  const btn = document.getElementById('btn-cloud'); if (!btn) return;
  let d = btn.querySelector('.live-dot-legacy');
  if (show) {
    if (!d) {
      d = document.createElement('span');
      d.className = 'live-dot-legacy';
      d.style.cssText = 'position:absolute;top:3px;right:3px;width:7px;height:7px;background:#22c55e;border-radius:50%;border:1.5px solid rgba(15,20,36,.9);pointer-events:none;animation:pulse-dot 2s infinite;';
      btn.appendChild(d);
    }
  } else d?.remove();
}

// ── NOTES ──────────────────────────────────────────────────────
function _noteKeyHandler(e) {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const noteOpen = document.getElementById('note-overlay')?.style.display !== 'none';
  if (noteOpen) { if (e.key === 'Enter') { e.preventDefault(); submitNote(); } if (e.key === 'Escape') cancelNote(); return; }
  if (e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.altKey && !e.metaKey) { SC.noteMode = true; clearTimeout(SC.noteModeTimer); SC.noteModeTimer = setTimeout(() => { SC.noteMode = false; }, 1500); }
  if (e.key === 'Enter' && SC.noteMode) { e.preventDefault(); SC.noteMode = false; clearTimeout(SC.noteModeTimer); if (SC.notes[SC.user?.id]) removeMyNote(); else openNoteOverlay(); }
}
function openNoteOverlay() {
  const o = document.getElementById('note-overlay'), w = document.getElementById('note-input-wrap'), ta = document.getElementById('note-textarea');
  if (!o || !SC.user) return;
  const scr = SC.lastMouseScr || { x: innerWidth / 2, y: innerHeight / 2 };
  w.style.left = Math.min(scr.x + 16, innerWidth - 350) + 'px'; w.style.top = Math.min(scr.y - 20, innerHeight - 200) + 'px';
  if (ta) ta.value = ''; const cnt = document.getElementById('note-word-count'); if (cnt) cnt.textContent = '0 слов';
  o.style.display = ''; setTimeout(() => ta?.focus(), 30);
}
window.submitNote = function () {
  const ta = document.getElementById('note-textarea'), text = ta?.value?.trim(); if (!text) { cancelNote(); return; }
  document.getElementById('note-overlay').style.display = 'none'; if (!SC.user) return;
  SC.notes[SC.user.id] = { x: SC.lastCursorX, y: SC.lastCursorY, text };
  showNoteOnCanvas(SC.user.id, SC.user.name, SC.user.color, SC.user.av, SC.lastCursorX + 16, SC.lastCursorY, text, true);
  const ch = SC.liveMode ? SC.channel : (SC.watchMode ? SC.watchChannel : null);
  if (ch) ch.send({ type: 'broadcast', event: 'note_update', payload: { uid: SC.user.id, name: SC.user.name, color: SC.user.color, av: SC.user.av, x: SC.lastCursorX + 16, y: SC.lastCursorY, text } });
};
window.cancelNote = function () { document.getElementById('note-overlay').style.display = 'none'; };
window.removeMyNote = function () {
  if (!SC.user) return; delete SC.notes[SC.user.id]; document.getElementById('note_' + SC.user.id)?.remove();
  const ch = SC.liveMode ? SC.channel : (SC.watchMode ? SC.watchChannel : null);
  if (ch) ch.send({ type: 'broadcast', event: 'note_update', payload: { uid: SC.user.id, name: SC.user.name, color: SC.user.color, av: SC.user.av, x: 0, y: 0, text: '' } });
};
window.showNoteOnCanvas = function (uid, name, color, av, x, y, text, isMine) {
  let layer = document.getElementById('ws-cursor-layer');
  if (!layer) { layer = document.createElement('div'); layer.id = 'ws-cursor-layer'; layer.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:1800;'; document.body.appendChild(layer); }
  document.getElementById('note_' + uid)?.remove(); if (!text) return;
  const div = document.createElement('div'); div.id = 'note_' + uid; div.style.cssText = `position:absolute;left:${x}px;top:${y}px;pointer-events:${isMine ? 'auto' : 'none'};z-index:202;`;
  div.innerHTML = `<div style="background:${color};color:#fff;border-radius:0 9px 9px 9px;padding:6px 10px;max-width:200px;box-shadow:0 3px 10px rgba(0,0,0,.22);font-size:11px;line-height:1.5;"><div style="font-size:9px;font-weight:700;margin-bottom:3px;display:flex;justify-content:space-between;"><span>${av} ${name}</span>${isMine ? `<span onclick="removeMyNote()" style="cursor:pointer;opacity:.75;margin-left:8px;">✕</span>` : ''}</div><div>${text}</div></div>`;
  layer.appendChild(div);
};

// ── TOAST ──────────────────────────────────────────────────────
window.wsToast = function (msg, type = 'info') {
  const t = document.getElementById('ws-toast'); if (!t) return;
  const bg = { success: '#22c55e', error: '#ef4444', warn: '#f59e0b', info: '#3b82f6' };
  t.style.background = bg[type] || bg.info; t.style.color = '#fff'; t.textContent = msg;
  t.style.opacity = '1'; t.style.transform = 'translateY(0)';
  clearTimeout(t._t); t._t = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(12px)'; }, 3500);
};

// createCGWindows is defined in workspace_cg.js (shows mode-choice dialog).
// Stubs to prevent errors from any old HTML onclick references:
window.openCGPanel = function () { };
window.closeCGPanel = function () { };

// ── NEW PROJECT DIALOG ─────────────────────────────────────────
window.newProjectDialog = function () {
  document.getElementById('new-project-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'new-project-modal';
  m.style.cssText =
    'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.6);' +
    'display:flex;align-items:center;justify-content:center;';
  m.innerHTML = `
    <div style="background:#1a1d2e;border:1px solid rgba(0,255,204,.3);border-radius:14px;
                padding:24px 28px;min-width:340px;color:#e0e6ed;font-family:Segoe UI,sans-serif;
                box-shadow:0 20px 60px rgba(0,0,0,.7);">
      <div style="font-size:15px;font-weight:700;margin-bottom:16px;">🆕 Новый проект</div>
      <input id="new-proj-name" type="text" class="ws-inp" placeholder="Название проекта (напр. my_project)"
             style="width:100%;margin-bottom:14px;" autofocus>
      <div style="display:flex;gap:10px;">
        <button class="ws-btn ws-btn-g" onclick="window._confirmNewProject()" style="flex:1;">✅ Создать</button>
        <button class="ws-btn ws-btn-s" onclick="document.getElementById('new-project-modal')?.remove()" style="flex:1;">Отмена</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  setTimeout(() => document.getElementById('new-proj-name')?.focus(), 50);
};
window._confirmNewProject = function () {
  const name = (document.getElementById('new-proj-name')?.value || '').trim().replace(/\s+/g, '_');
  if (!name) { wsToast('Введите название', 'warn'); return; }
  document.getElementById('new-project-modal')?.remove();

  if (SC.liveMode) stopLiveSession();
  if (SC.watchMode) _stopWatching();

  // Destroy CG panels, clear state, set new project base
  typeof window.destroyAllCGWorlds === 'function' && window.destroyAllCGWorlds();
  const blank = { bubbles: {}, minis: {}, links: {}, points: {}, cgData: {}, cgWindows: {} };
  window.setBubbleState && window.setBubbleState(blank);
  window.clearBubblePartSys && window.clearBubblePartSys();
  window.fullRebuild && window.fullRebuild();
  SC.projectBase = name; SC.currentInstanceId = null; SC.workingMode = null;
  document.getElementById('cloud-project-name') && (document.getElementById('cloud-project-name').value = name);
  _renderContextBar(); wsToast('🆕 Проект: ' + name, 'success');
};
