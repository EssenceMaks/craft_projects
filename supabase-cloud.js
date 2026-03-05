// ════════════════════════════════════════════════════════════════
// SUPABASE CLOUD INTEGRATION v2 — Component Generator
// ════════════════════════════════════════════════════════════════
// Called explicitly: initCloud() at bottom of HTML
'use strict';

// ── Cloud state ───────────────────────────────────────────────
const SC = {
  client:        null,
  user:          null,
  projectBase:   null,    // base name, e.g. 'project_1' (instances derive from this)
  channel:       null,    // own live broadcast channel
  watchChannel:  null,    // channel we're subscribed to for watching another user
  liveMode:      false,   // are WE broadcasting?
  watchMode:     false,   // are we watching someone else?
  watchTarget:   null,    // userId being watched
  liveCursors:   {},      // { userId: domElement }
  autosaveTimer: null,    // cloud autosave (3 min, only while live)
  localTimer:    null,    // localStorage autosave (15 sec, always)
  cursorThrottle:null,    // cursor broadcast throttle
  loginSelected: null,
};

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════
window.initCloud = function() {
  if (typeof supabase === 'undefined') {
    console.warn('[Cloud] supabase-js not loaded');
    return;
  }
  try {
    SC.client = supabase.createClient(SUPA_URL, SUPA_KEY);
  } catch(e) {
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
    ca.addEventListener('mousemove', e => {
      if (!SC.liveMode || !SC.channel) return;
      if (SC.cursorThrottle) return;
      SC.cursorThrottle = setTimeout(() => { SC.cursorThrottle = null; }, 50);
      const rect = ca.getBoundingClientRect();
      SC.channel.send({
        type: 'broadcast', event: 'cursor',
        payload: {
          uid: SC.user.id, name: SC.user.name, color: SC.user.color, av: SC.user.av,
          x: Math.round(ca.scrollLeft + e.clientX - rect.left),
          y: Math.round(ca.scrollTop + e.clientY - rect.top)
        }
      });
    });
  }
  restoreSession();
  startLocalAutosave();
  buildLoginModal();
};

// ════════════════════════════════════════════════════════════════
// AUTH (Soft — no Supabase registration needed)
// ════════════════════════════════════════════════════════════════
function restoreSession() {
  const saved = localStorage.getItem('cg_user');
  if (saved) {
    try { SC.user = JSON.parse(saved); renderUserBadge(); return; } catch(e) {}
  }
  showLoginModal();
}

window.showLoginModal = function() {
  const m = document.getElementById('cloud-login-modal');
  if (m) m.classList.remove('hidden');
};

function buildLoginModal() {
  const list = document.getElementById('login-user-list');
  if (!list) return;
  list.innerHTML = TEAM_USERS.map(u => `
    <div class="login-user-card" data-uid="${u.id}"
         style="border-left:4px solid ${u.color};"
         onclick="selectLoginUser('${u.id}')">
      <span class="login-av" style="background:${u.color};">${u.av}</span>
      <span style="font-weight:700;">${u.name}</span>
    </div>
  `).join('');
}

window.selectLoginUser = function(uid) {
  SC.loginSelected = uid;
  document.querySelectorAll('.login-user-card').forEach(c =>
    c.classList.toggle('sel', c.dataset.uid === uid)
  );
  document.getElementById('login-pass')?.focus();
};

window.doLogin = function() {
  const uid = SC.loginSelected;
  const pass = document.getElementById('login-pass')?.value || '';
  if (!uid) { cloudToast('Выберите пользователя', 'warn'); return; }
  const u = TEAM_USERS.find(u => u.id === uid);
  if (!u || u.pass !== pass) { cloudToast('Неверный пароль!', 'error'); return; }
  SC.user = { id: u.id, name: u.name, color: u.color, av: u.av };
  localStorage.setItem('cg_user', JSON.stringify(SC.user));
  renderUserBadge();
  document.getElementById('cloud-login-modal').classList.add('hidden');
  if (document.getElementById('login-pass')) document.getElementById('login-pass').value = '';
  cloudToast('Привет, ' + u.name + '!', 'success');
  restoreLocalDraft();
};

window.logoutUser = function() {
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
        onclick="logoutUser()" title="Выйти (${SC.user.name})">
        ${SC.user.av} ${SC.user.name}
      </span>`;
  } else {
    b.innerHTML = `<button class="btn btn-s" onclick="showLoginModal()"
      style="font-size:11px;padding:3px 9px;">Войти</button>`;
  }
  const lbl = document.getElementById('cloud-project-label');
  if (lbl) lbl.textContent = SC.projectBase ? '📁 ' + SC.projectBase : '—';
}

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
    } catch(e) {}
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
  } catch(e) {}
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
window.pushToCenter = async function(baseName) {
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
window.loadInstance = async function(instanceId) {
  if (!SC.client) { cloudToast('Supabase не настроен', 'warn'); return; }
  const { data, error } = await SC.client.from('projects').select('*').eq('id', instanceId).single();
  if (error || !data) { cloudToast('Не найден: ' + (error?.message || ''), 'error'); return; }
  S.items = data.data?.items || [];
  S.connections = data.data?.connections || [];
  S.selId = null; S.selIds = []; S.selIsCopy = false; S.selConnId = null;
  const m = instanceId.match(/^(.+)_экземпляр_\d+$/);
  SC.projectBase = m ? m[1] : instanceId;
  renderCanvas(); renderDom(); updAnimBtn(); updPreview();
  renderUserBadge();
  cloudToast('Загружен: ' + instanceId, 'success');
};

// Delete a central instance
window.deleteInstance = async function(id) {
  if (!confirm('Удалить ' + id + '?')) return;
  if (!SC.client) return;
  await SC.client.from('projects').delete().eq('id', id);
  cloudToast('Удалено: ' + id, 'info');
  await refreshCloudModal();
};

// Save locally with a chosen name (Approve)
window.approveLocal = function() {
  const def = (SC.projectBase || 'project') + '_апрув_' + new Date().toISOString().slice(0,10);
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
window.loadLocalSave = function(id) {
  const saves = JSON.parse(localStorage.getItem('cg_local_saves') || '[]');
  const s = saves.find(x => x.id === id);
  if (!s) { cloudToast('Не найдено', 'error'); return; }
  S.items = s.data?.items || []; S.connections = s.data?.connections || [];
  S.selId = null; S.selIds = []; S.selIsCopy = false; S.selConnId = null;
  renderCanvas(); renderDom(); updAnimBtn(); updPreview();
  cloudToast('Загружен: ' + s.name, 'success');
};

// Push a local save to central as a new instance
window.pushLocalSave = async function(id) {
  const saves = JSON.parse(localStorage.getItem('cg_local_saves') || '[]');
  const s = saves.find(x => x.id === id); if (!s) return;
  const prev = { items: S.items, connections: S.connections };
  S.items = s.data.items || []; S.connections = s.data.connections || [];
  await pushToCenter();
  S.items = prev.items; S.connections = prev.connections;
};

// Compatibility aliases
window.saveToCloud = function(type, customName) {
  if (type === 'approved' || type === 'manual') return pushToCenter(customName);
};
window.approveToCloud = window.approveLocal;

// Download snapshot as JSON
window.downloadSnapshot = function() {
  const json = JSON.stringify({ items: S.items, connections: S.connections }, null, 2);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  a.download = (SC.projectBase || 'snapshot') + '_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  cloudToast('Слепок скачан', 'success');
};

// Import snapshot from JSON file
window.importSnapshot = function() {
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
    } catch(err) { cloudToast('Ошибка файла', 'error'); }
  };
  input.click();
};

// ════════════════════════════════════════════════════════════════
// CLOUD MODAL (3 tabs: Central / Live / Local)
// ════════════════════════════════════════════════════════════════
window.showCloudModal = async function() {
  const m = document.getElementById('cloud-modal');
  if (!m) return;
  m.classList.remove('hidden');
  await refreshCloudModal();
};

window.closeCloudModal = function() {
  document.getElementById('cloud-modal')?.classList.add('hidden');
};

window.switchCloudTab = function(tab) {
  ['central','live','local'].forEach(t => {
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
    Object.entries(groups).sort((a,b) => a[0].localeCompare(b[0])).forEach(([base, items]) => {
      html += `<div style="margin-bottom:14px;">
        <div style="font-size:11px;font-weight:700;color:var(--p);padding:4px 0;border-bottom:1px solid #e9d5ff;margin-bottom:6px;">📁 ${base}</div>`;
      items.sort((a,b) => b.num - a.num).forEach(p => {
        html += `<div style="padding:6px 9px;border:1px solid var(--bd);border-radius:5px;margin-bottom:4px;
          background:#fff;display:flex;justify-content:space-between;align-items:center;gap:7px;">
          <div style="flex:1;min-width:0;">
            <span style="font-weight:700;font-size:12px;">Экземпляр ${p.num || p.id}</span>
            <span style="font-size:10px;color:var(--mu);margin-left:7px;">${p.owner||'?'} · ${p.updated_at?.slice(0,16)||''}</span>
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
      .select('id, owner, updated_at').eq('live', true).ilike('id', 'live_%');
    (liveRecs || []).forEach(p => {
      const uid = p.id.replace('live_', '');
      const u = TEAM_USERS.find(x => x.id === uid);
      const isSelf = SC.user?.id === uid;
      liveHtml += `<div style="padding:7px 10px;border:2px solid ${u?.color||'#e5e7eb'};
        border-radius:6px;margin-bottom:6px;background:#fff;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <span style="display:inline-block;background:${u?.color||'#8b5cf6'};color:#fff;
            padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;margin-right:6px;">● ${u?.av||'?'}</span>
          <span style="font-weight:700;font-size:12px;">${u?.name||uid}</span>
          <span style="font-size:10px;color:var(--mu);margin-left:7px;">${p.updated_at?.slice(11,16)||''}</span>
        </div>
        ${isSelf
          ? '<span style="font-size:10px;color:var(--mu);">это вы</span>'
          : `<button class="btn btn-b" style="font-size:10px;padding:3px 10px;" onclick="watchLive('${uid}');closeCloudModal();">👁 Наблюдать</button>`
        }
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

window.toggleLiveSession = async function() {
  if (SC.liveMode) await stopLiveSession();
  else await startLiveSession();
};

async function startLiveSession() {
  if (!SC.client) { cloudToast('Supabase не настроен', 'warn'); return; }
  if (!SC.user) { showLoginModal(); return; }

  // Register live record in DB (others will see this user as live)
  const liveId = 'live_' + SC.user.id;
  await SC.client.from('projects').upsert({
    id: liveId, name: 'Live: ' + SC.user.name,
    data: JSON.parse(JSON.stringify({ items: S.items, connections: S.connections })),
    owner: SC.user.id, live: true,
    updated_at: new Date().toISOString()
  }, { onConflict: 'id' });

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
    SC.channel.send({ type: 'broadcast', event: 'full_sync',
      payload: { items: S.items, connections: S.connections, base: SC.projectBase } });
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
}

async function stopLiveSession() {
  stopLiveAutosave();
  if (SC.channel) { await SC.channel.unsubscribe(); SC.channel = null; }
  if (SC.client && SC.user) {
    SC.client.from('projects').update({ live: false }).eq('id', 'live_' + SC.user.id);
  }
  SC.liveMode = false;
  document.getElementById('online-users').innerHTML = '';
  clearRemoteCursors();
  updateLiveUI('off', '');
  cloudToast('Live остановлен', 'info');
}

// Watch another user's live session
window.watchLive = async function(targetUserId) {
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
    renderCanvas(); renderDom(); updAnimBtn();
  });

  SC.watchChannel.on('broadcast', { event: 'css_change' }, ({ payload }) =>
    applyRemoteCss(payload)
  );

  SC.watchChannel.on('broadcast', { event: 'cursor' }, ({ payload }) =>
    updateRemoteCursor(payload)
  );

  await SC.watchChannel.subscribe(async status => {
    if (status === 'SUBSCRIBED') {
      await SC.watchChannel.track({ user: SC.user.name, color: SC.user.color, av: SC.user.av });
      // Request current state
      SC.watchChannel.send({ type: 'broadcast', event: 'request_sync', payload: {} });
    }
  });

  SC.watchMode = true;
  SC.watchTarget = targetUserId;
  const u = TEAM_USERS.find(x => x.id === targetUserId);
  updateLiveUI('watch', u?.name || targetUserId);
  cloudToast('👁 Наблюдаете за ' + (u?.name || targetUserId), 'info');
};

async function stopWatching() {
  if (SC.watchChannel) { await SC.watchChannel.unsubscribe(); SC.watchChannel = null; }
  SC.watchMode = false; SC.watchTarget = null;
  clearRemoteCursors();
  updateLiveUI('off', '');
}

// ── Broadcast / Apply CSS ────────────────────────────────────
window.broadcastCss = function(elId, css, isCopy, connId) {
  if (!SC.liveMode || !SC.channel) return;
  SC.channel.send({
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
function updateRemoteCursor({ uid, name, color, av, x, y }) {
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
    `<span title="${u.user}" style="background:${u.color||'#8b5cf6'};color:#fff;
      padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;margin-left:3px;">
      ${u.av||(u.user||'?').slice(0,2)}</span>`
  ).join('');
}

function updateLiveUI(mode, label) {
  const btn = document.getElementById('live-btn');
  const status = document.getElementById('live-status');
  if (mode === 'live') {
    if (btn) { btn.style.background = '#22c55e'; btn.style.color = '#fff'; btn.textContent = '● LIVE'; btn.title = 'Остановить Live'; }
    if (status) { status.textContent = label; status.style.color = '#22c55e'; }
  } else if (mode === 'watch') {
    if (btn) { btn.style.background = '#3b82f6'; btn.style.color = '#fff'; btn.textContent = '👁 ' + label; btn.title = 'Выйти из просмотра (клик)'; }
    if (status) { status.textContent = ''; }
    btn && (btn.onclick = async () => { await stopWatching(); btn.onclick = () => toggleLiveSession(); });
  } else {
    if (btn) { btn.style.background = ''; btn.style.color = ''; btn.textContent = '⚡ Live'; btn.title = 'Запустить Live'; btn.onclick = () => toggleLiveSession(); }
    if (status) { status.textContent = ''; }
  }
  renderUserBadge();
}

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
