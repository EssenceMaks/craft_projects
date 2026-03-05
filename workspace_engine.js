'use strict';
// ════════════════════════════════════════════════════════════════
// WORKSPACE ENGINE — Integration layer
// Runs AFTER bubble engine (workspace_engine.js) + supabase-config.js
// Provides: auth, cloud save/load, live sessions, CG panel management
// ════════════════════════════════════════════════════════════════

const SC = window.SC = {
  client:null, user:null, projectBase:null,
  workingMode:null, currentInstanceId:null, currentLocalSave:null,
  channel:null, watchChannel:null, globalChannel:null,
  liveMode:false, watchMode:false, watchReadOnly:false, watchTarget:null,
  liveCursors:{}, notes:{},
  noteMode:false, noteModeTimer:null,
  lastCursorX:0, lastCursorY:0, lastMouseScr:null,
  cursorThrottle:null, broadcastTimer:null, liveAutoTimer:null,
  loginSelected:null, modalRefreshTimer:null, _switchingUser:false,
  activeCgBubbleId:null
};

// ── INIT ───────────────────────────────────────────────────────
window.initWorkspace = function() {
  // Hook CG items into bubble right-click menu
  window._cgContextMenuHook = (bubbleId, ctxEl) => {
    const sep = document.createElement('div'); sep.className = 'ctx-sep'; ctxEl.appendChild(sep);
    const btn = document.createElement('div'); btn.className = 'ctx-btn accent';
    btn.textContent = '🧩 Создать окна CG';
    btn.onclick = ev => { ev.stopPropagation(); ctxEl.style.display='none'; createCGWindows(bubbleId); };
    ctxEl.appendChild(btn);
  };

  // Cloud/Supabase init
  if (typeof supabase !== 'undefined' && typeof SUPA_URL !== 'undefined') {
    try { SC.client = supabase.createClient(SUPA_URL, SUPA_KEY); } catch(e) { console.warn('[WS] Supabase init failed:', e); }
  }

  // Cursor tracking for live broadcasts
  document.getElementById('pixi-canvas')?.addEventListener('mousemove', e => {
    if (!SC.user) return;
    const wc = window.worldContainer; if (!wc) return;
    SC.lastCursorX = Math.round((e.clientX-wc.x)/wc.scale.x);
    SC.lastCursorY = Math.round((e.clientY-wc.y)/wc.scale.y);
    SC.lastMouseScr = { x:e.clientX, y:e.clientY };
    const ch = SC.liveMode ? SC.channel : (SC.watchMode ? SC.watchChannel : null);
    if (!ch) return;
    if (SC.cursorThrottle) return;
    SC.cursorThrottle = setTimeout(()=>{ SC.cursorThrottle=null; }, 50);
    ch.send({type:'broadcast',event:'cursor',payload:{uid:SC.user.id,name:SC.user.name,color:SC.user.color,av:SC.user.av,x:SC.lastCursorX,y:SC.lastCursorY}});
  });

  // E+Enter note system
  document.addEventListener('keydown', _noteKeyHandler);
  document.getElementById('note-textarea')?.addEventListener('input', e => {
    const w = e.target.value.trim().split(/\s+/).filter(Boolean).length;
    const el = document.getElementById('note-word-count'); if (el) el.textContent = w+' слов';
  });

  // Local autosave every 30s
  setInterval(() => {
    try { localStorage.setItem('ws_draft', JSON.stringify({snapshot:_getSnap(), projectBase:SC.projectBase, ts:Date.now()})); } catch(e){}
  }, 30000);

  buildLoginModal();
  _restoreSession();
};

// ── AUTH ───────────────────────────────────────────────────────
function _restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem('ws_user')||'null');
    if (saved?.id) {
      SC.user = saved;
      window._bubbleSetUser && window._bubbleSetUser(saved);
      renderUserBadge();
      setTimeout(_joinGlobalChannel, 800);
      _restoreDraft(); return;
    }
  } catch(e) {}
  showLoginModal();
}

window.showLoginModal = function() {
  const m = document.getElementById('ws-login-modal'); if (!m) return;
  buildLoginModal(); m.classList.remove('hidden');
  const cb = document.getElementById('login-modal-close'); if (cb) cb.style.display = SC.user ? '' : 'none';
};
window.closeLoginModal = function() {
  document.getElementById('ws-login-modal')?.classList.add('hidden');
  SC._switchingUser = false; SC.loginSelected = null;
  document.querySelectorAll('.login-user-card').forEach(c=>c.classList.remove('sel'));
  const lp = document.getElementById('login-pass'); if (lp) lp.value = '';
};

function buildLoginModal() {
  const list = document.getElementById('login-user-list'); if (!list) return;
  list.innerHTML = TEAM_USERS.map(u => {
    const isCur = SC.user?.id === u.id;
    return `<div class="login-user-card" data-uid="${u.id}"
      style="border-left:4px solid ${u.color};${isCur?'opacity:.4;pointer-events:none;':''}"
      onclick="selectLoginUser('${u.id}')">
      <span class="login-av" style="background:${u.color};">${u.av}</span>
      <span style="font-weight:700;">${u.name}</span>
      ${isCur?'<span style="font-size:9px;color:#7a8599;margin-left:auto;">✓ текущий</span>':''}
    </div>`;
  }).join('');
  const t = document.getElementById('login-modal-title');
  if (t) t.childNodes[0].textContent = SC._switchingUser ? '🔄 Сменить' : '👤 Войти';
}

window.selectLoginUser = function(uid) {
  SC.loginSelected = uid;
  document.querySelectorAll('.login-user-card').forEach(c=>c.classList.toggle('sel', c.dataset.uid===uid));
  document.getElementById('login-pass')?.focus();
};

window.doLogin = function() {
  const uid = SC.loginSelected, pass = document.getElementById('login-pass')?.value||'';
  if (!uid) { wsToast('Выберите пользователя','warn'); return; }
  const u = TEAM_USERS.find(x=>x.id===uid);
  if (!u || u.pass !== pass) { wsToast('Неверный пароль!','error'); return; }
  SC.user = { id:u.id, name:u.name, color:u.color, av:u.av };
  localStorage.setItem('ws_user', JSON.stringify(SC.user));
  window._bubbleSetUser && window._bubbleSetUser(SC.user);
  renderUserBadge(); closeLoginModal();
  wsToast('Привет, '+u.name+'!','success');
  _restoreDraft();
  setTimeout(_joinGlobalChannel, 600);
};

window.showAccountPanel = function() {
  document.getElementById('account-panel')?.remove();
  if (!SC.user) { showLoginModal(); return; }
  const u = SC.user;
  const p = document.createElement('div'); p.id='account-panel';
  p.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
    <div style="display:flex;gap:8px;align-items:center;">
      <span style="background:${u.color};color:#fff;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;">${u.av}</span>
      <div><div style="font-weight:700;font-size:13px;color:#e0e6ed;">${u.name}</div><div style="font-size:10px;color:#7a8599;">@${u.id}</div></div>
    </div>
    <span onclick="closeAccountPanel()" style="cursor:pointer;color:#7a8599;font-size:18px;">×</span>
  </div>
  <div style="font-size:10px;color:#7a8599;margin-bottom:10px;border-top:1px solid rgba(255,255,255,.08);padding-top:8px;">
    ${SC.liveMode?'<span style="color:#22c55e;font-weight:700;">● LIVE&nbsp;</span>':''}${SC.watchMode?'<span style="color:#3b82f6;font-weight:700;">✏️ Совм.&nbsp;</span>':''}
    ${SC.workingMode==='central'?'🌐 '+(SC.currentInstanceId||'центральный'):SC.workingMode==='local'?'💾 '+(SC.currentLocalSave||'локальный'):SC.projectBase?'📁 '+SC.projectBase:'― черновик'}
  </div>
  <button class="ws-btn ws-btn-s" onclick="_switchAccount()" style="width:100%;font-size:11px;margin-bottom:6px;">🔄 Сменить</button>
  <button class="ws-btn ws-btn-rl" onclick="_confirmLogout()" style="width:100%;font-size:11px;">→ Выйти</button>`;
  document.body.appendChild(p);
  setTimeout(()=>document.addEventListener('mousedown',_apClose,{once:true}),50);
};
function _apClose(e) { if (!document.getElementById('account-panel')?.contains(e.target)) closeAccountPanel(); }
window.closeAccountPanel = function() { document.getElementById('account-panel')?.remove(); document.removeEventListener('mousedown',_apClose); };
window._switchAccount = function() {
  closeAccountPanel();
  if ((SC.liveMode||SC.watchMode)&&!confirm('Вы в активной сессии. Продолжить?')) return;
  if (SC.liveMode) stopLiveSession(); if (SC.watchMode) _stopWatching();
  SC._switchingUser=true; showLoginModal();
};
window._confirmLogout = function() {
  closeAccountPanel();
  if ((SC.liveMode||SC.watchMode)&&!confirm('Выйти из активной сессии?')) return;
  if (SC.liveMode) stopLiveSession(); if (SC.watchMode) _stopWatching();
  SC.user=null; localStorage.removeItem('ws_user');
  window._bubbleSetUser && window._bubbleSetUser(null);
  renderUserBadge(); showLoginModal();
};

function renderUserBadge() {
  const b = document.getElementById('user-badge'); if (!b) return;
  b.innerHTML = SC.user
    ? `<span style="background:${SC.user.color};color:#fff;padding:3px 9px;border-radius:10px;font-size:11px;font-weight:700;cursor:pointer;" onclick="showAccountPanel()">${SC.user.av} ${SC.user.name}</span>`
    : `<button class="cb-btn" onclick="showLoginModal()">Войти</button>`;
  _renderContextBar();
}

function _renderContextBar() {
  const cL=document.getElementById('ctx-local'), cG=document.getElementById('ctx-global'); if (!cL) return;
  if (!SC.user) { cL.textContent='—'; cG.textContent=''; return; }
  let who=SC.user.av+' '+SC.user.name;
  if (SC.watchMode&&SC.watchTarget) { const h=TEAM_USERS.find(x=>x.id===SC.watchTarget); who+=(SC.watchReadOnly?'  👁 ':'  ✏️ ')+(h?.name||SC.watchTarget); }
  else if (SC.liveMode) who+='  📡 LIVE';
  cL.textContent=who;
  let vl=SC.workingMode==='central'&&SC.currentInstanceId?'🌐 '+SC.currentInstanceId:SC.workingMode==='local'&&SC.currentLocalSave?'💾 '+SC.currentLocalSave:SC.projectBase?'📁 '+SC.projectBase:'― черновик';
  cG.textContent=vl;
}

// ── SNAPSHOT HELPERS ───────────────────────────────────────────
function _getSnap() {
  const wc=window.worldContainer;
  return { state:window.getBubbleState(), camera:wc?{x:wc.x,y:wc.y,scale:wc.scale.x}:{x:0,y:0,scale:1} };
}
function _applySnap(snap) {
  if (!snap?.state) return;
  window.setBubbleState(snap.state);
  if (snap.camera&&window.worldContainer) { window.worldContainer.x=snap.camera.x; window.worldContainer.y=snap.camera.y; window.worldContainer.scale.set(snap.camera.scale); }
  window.clearBubblePartSys && window.clearBubblePartSys();
  window.fullRebuild && window.fullRebuild();
  window.syncGPUI && window.syncGPUI();
  window.selectEntity && window.selectEntity(null,null);
  window.queueRender && window.queueRender();
}
function _restoreDraft() {
  try {
    const d=JSON.parse(localStorage.getItem('ws_draft')||'null');
    if (!d?.snapshot?.state) return;
    _applySnap(d.snapshot);
    if (d.projectBase) SC.projectBase=d.projectBase;
    _renderContextBar(); wsToast('Черновик восстановлен','info');
  } catch(e){}
}

// ── SAVE / LOAD ────────────────────────────────────────────────
window.approveLocal = function() {
  const nameEl=document.getElementById('local-save-name');
  const name=(nameEl?.value||'').trim()||(SC.projectBase||'workspace')+'_'+new Date().toISOString().slice(0,10);
  const saves=JSON.parse(localStorage.getItem('ws_local_saves')||'[]');
  const id=name.replace(/\s+/g,'_');
  const idx=saves.findIndex(s=>s.id===id);
  const entry={id,name,ts:Date.now(),..._getSnap()};
  if (idx>=0) saves[idx]=entry; else saves.unshift(entry);
  localStorage.setItem('ws_local_saves',JSON.stringify(saves.slice(0,20)));
  SC.currentLocalSave=name; SC.workingMode='local';
  wsToast('💾 Сохранено локально: '+name,'success'); _renderContextBar();
};
window.loadLocalSave = function(id) {
  const saves=JSON.parse(localStorage.getItem('ws_local_saves')||'[]');
  const s=saves.find(x=>x.id===id); if (!s) return;
  _applySnap(s); SC.currentLocalSave=s.name; SC.workingMode='local';
  wsToast('💾 Загружено: '+s.name,'success'); _renderContextBar(); closeCloudModal();
};
window.pushToCenter = async function(customName) {
  if (!SC.client) { wsToast('Supabase не настроен','warn'); return; }
  if (!SC.user) { showLoginModal(); return; }
  const base=customName||(document.getElementById('cloud-project-name')?.value||'').trim()||SC.projectBase||'workspace_1';
  SC.projectBase=base;
  const {data:ex}=await SC.client.from('projects').select('id').ilike('id',base+'_экземпляр_%').not('id','ilike','live_%').order('id',{ascending:false}).limit(1);
  let n=1; if (ex?.[0]){const m=ex[0].id.match(/_экземпляр_(\d+)$/);if(m)n=parseInt(m[1])+1;}
  const newId=base+'_экземпляр_'+n;
  const {error}=await SC.client.from('projects').upsert({id:newId,name:newId,data:_getSnap(),owner:SC.user.id,live:false,updated_at:new Date().toISOString()},{onConflict:'id'});
  if (error){wsToast('Ошибка: '+error.message,'error');return;}
  SC.currentInstanceId=newId; SC.workingMode='central';
  wsToast('📤 Сохранено: '+newId,'success'); _renderContextBar();
};
window.loadInstance = async function(id) {
  if (!SC.client) return;
  const {data}=await SC.client.from('projects').select('data').eq('id',id).single();
  if (!data?.data){wsToast('Нет данных','error');return;}
  _applySnap(data.data);
  const m=id.match(/^(.+)_экземпляр_/); if (m) SC.projectBase=m[1];
  SC.currentInstanceId=id; SC.workingMode='central';
  wsToast('⬇ Загружено: '+id,'success'); _renderContextBar(); closeCloudModal();
};
window.deleteInstance = async function(id) {
  if (!SC.client||!confirm('Удалить '+id+'?')) return;
  await SC.client.from('projects').delete().eq('id',id);
  wsToast('Удалено: '+id,'info'); refreshCloudModal();
};
window.copyHostLocally = async function() {
  if (!SC.watchTarget||!SC.client){wsToast('Сначала начните наблюдение','warn');return;}
  const {data}=await SC.client.from('projects').select('data').eq('id','live_'+SC.watchTarget).single();
  if (!data?.data){wsToast('Нет данных','error');return;}
  const u=TEAM_USERS.find(x=>x.id===SC.watchTarget);
  const name=(SC.projectBase||'workspace')+'_копия_'+(u?.name||SC.watchTarget);
  const saves=JSON.parse(localStorage.getItem('ws_local_saves')||'[]');
  saves.unshift({id:name.replace(/\s+/g,'_'),name,ts:Date.now(),...data.data});
  localStorage.setItem('ws_local_saves',JSON.stringify(saves.slice(0,20)));
  wsToast('📋 Скопировано: '+name,'success');
};

// ── CLOUD MODAL ────────────────────────────────────────────────
window.showCloudModal = async function() {
  const m=document.getElementById('ws-cloud-modal'); if (!m) return;
  m.classList.remove('hidden'); await refreshCloudModal();
  SC.modalRefreshTimer=setInterval(()=>{if(!m.classList.contains('hidden'))refreshCloudModal();else{clearInterval(SC.modalRefreshTimer);}},20000);
};
window.closeCloudModal = function() {
  document.getElementById('ws-cloud-modal')?.classList.add('hidden');
  clearInterval(SC.modalRefreshTimer);
};
window.switchCloudTab = function(tab) {
  ['central','live','local'].forEach(t=>{ document.getElementById('ctab-'+t)?.classList.toggle('on',t===tab); const p=document.getElementById('ctab-'+t+'-panel');if(p)p.style.display=t===tab?'':'none'; });
};
window.refreshCloudModal = async function() {
  // Central
  if (!SC.client) { document.getElementById('cloud-central-list').innerHTML='<div style="color:#7a8599;font-size:12px;padding:10px;">Supabase не подключён</div>'; }
  else {
    const {data:projs}=await SC.client.from('projects').select('id,owner,updated_at').not('id','ilike','live_%').order('id',{ascending:false});
    const grp={}; (projs||[]).forEach(p=>{const m=p.id.match(/^(.+)_экземпляр_(\d+)$/);const b=m?m[1]:'other';if(!grp[b])grp[b]=[];grp[b].push({...p,num:m?parseInt(m[2]):0});});
    let h=''; Object.entries(grp).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([base,items])=>{h+=`<div style="margin-bottom:12px;"><div style="font-size:11px;font-weight:700;color:#8b5cf6;padding:3px 0;border-bottom:1px solid rgba(139,92,246,.2);margin-bottom:5px;">📁 ${base}</div>`;items.sort((a,b)=>b.num-a.num).forEach(p=>{h+=`<div class="cloud-inst-row"><div style="flex:1;min-width:0;"><span style="font-weight:700;font-size:12px;">Экз. ${p.num}</span> <span style="font-size:10px;color:#7a8599;">${p.owner||''} · ${p.updated_at?.slice(0,16)||''}</span></div><div style="display:flex;gap:4px;"><button class="ws-btn ws-btn-s" style="font-size:10px;padding:3px 8px;" onclick="loadInstance('${p.id}')">⬇ Взять</button><button class="ws-btn ws-btn-rl" style="font-size:10px;padding:3px 7px;" onclick="deleteInstance('${p.id}')">✕</button></div></div>`;});h+='</div>';});
    document.getElementById('cloud-central-list').innerHTML=h||'<div style="color:#7a8599;font-size:12px;padding:10px;">Нет экземпляров</div>';
  }
  // Live
  let lH=''; if (SC.client){const {data:lr}=await SC.client.from('projects').select('id,owner,updated_at,version_label').eq('live',true).ilike('id','live_%');(lr||[]).forEach(p=>{const uid=p.id.replace('live_','');const u=TEAM_USERS.find(x=>x.id===uid);const isSelf=SC.user?.id===uid;lH+=`<div style="padding:8px;border:2px solid ${u?.color||'#555'};border-radius:7px;margin-bottom:7px;background:rgba(255,255,255,.02);"><div style="display:flex;justify-content:space-between;align-items:center;"><div><span style="background:${u?.color||'#555'};color:#fff;padding:1px 8px;border-radius:10px;font-size:10px;font-weight:700;">● ${u?.av||'?'}</span> <span style="font-weight:700;">${u?.name||uid}</span></div>${isSelf?'<span style="font-size:10px;color:#7a8599;font-style:italic;">это вы</span>':`<div style="display:flex;gap:4px;"><button class="ws-btn ws-btn-s" style="font-size:10px;padding:2px 8px;" onclick="watchLive('${uid}',true);closeCloudModal();">👁</button><button class="ws-btn ws-btn-p" style="font-size:10px;padding:2px 8px;" onclick="watchLive('${uid}',false);closeCloudModal();">✏️</button></div>`}</div></div>`; });}
  document.getElementById('cloud-live-list').innerHTML=lH||'<div style="color:#7a8599;font-size:12px;padding:9px;">Нет Live сессий</div>';
  // Local
  const saves=JSON.parse(localStorage.getItem('ws_local_saves')||'[]');
  document.getElementById('cloud-local-list').innerHTML=saves.map(s=>`<div class="cloud-inst-row"><div><span style="font-weight:700;font-size:11px;">${s.name}</span> <span style="font-size:9px;color:#7a8599;">${new Date(s.ts).toLocaleString('ru')}</span></div><div style="display:flex;gap:4px;"><button class="ws-btn ws-btn-s" style="font-size:10px;padding:2px 7px;" onclick="loadLocalSave('${s.id}')">↩</button></div></div>`).join('')||'<div style="color:#7a8599;font-size:12px;padding:9px;">Нет локальных сохранений</div>';
};

// ── LIVE SESSIONS ──────────────────────────────────────────────
window.toggleLiveSession = async function(){ if(SC.liveMode) await stopLiveSession(); else await startLiveSession(); };

async function startLiveSession() {
  if (!SC.client||!SC.user){if(!SC.user)showLoginModal();return;}
  const snap=_getSnap();
  const {error}=await SC.client.from('projects').upsert({id:'live_'+SC.user.id,name:'Live: '+SC.user.name,data:snap,owner:SC.user.id,live:true,version_label:SC.projectBase||'черновик',updated_at:new Date().toISOString()},{onConflict:'id'});
  if (error){wsToast('Ошибка Live: '+error.message,'error');return;}
  SC.channel=SC.client.channel('live_ch_'+SC.user.id,{config:{broadcast:{self:false},presence:{key:SC.user.id}}});
  SC.channel.on('presence',{event:'sync'},()=>_renderOnlineUsers(SC.channel.presenceState()));
  SC.channel.on('broadcast',{event:'request_sync'},()=>SC.channel.send({type:'broadcast',event:'full_sync',payload:_getSnap()}));
  SC.channel.on('broadcast',{event:'canvas_update'},({payload})=>{if(payload.from!==SC.user?.id)_applySnap(payload);});
  SC.channel.on('broadcast',{event:'cg_update'},({payload})=>{if(payload.from!==SC.user?.id)_applyCGUpdate(payload);});
  SC.channel.on('broadcast',{event:'cursor'},({payload})=>{if(payload.uid!==SC.user?.id)_updateCursor(payload);});
  SC.channel.on('broadcast',{event:'note_update'},({payload})=>{if(payload.uid!==SC.user?.id)showNoteOnCanvas(payload.uid,payload.name,payload.color,payload.av,payload.x,payload.y,payload.text);});
  await SC.channel.subscribe(async s=>{if(s==='SUBSCRIBED')await SC.channel.track({user:SC.user.name,color:SC.user.color,av:SC.user.av});});
  SC.liveMode=true; _startLiveAuto(); _updateLiveUI('live',SC.user.name);
  wsToast('● LIVE активен','success');
  _globalBroadcast('go_live',{uid:SC.user.id,name:SC.user.name,color:SC.user.color,av:SC.user.av}); _updateGlobalPresence(true);
}
window.stopLiveSession = async function() {
  _stopLiveAuto();
  if (SC.channel){await SC.channel.unsubscribe();SC.channel=null;}
  if (SC.client&&SC.user) SC.client.from('projects').update({live:false}).eq('id','live_'+SC.user.id);
  _globalBroadcast('go_offline',{uid:SC.user?.id}); _updateGlobalPresence(false);
  SC.liveMode=false; _clearCursors(); _updateLiveUI('off','');
  document.getElementById('online-users').innerHTML=''; wsToast('Live остановлен','info');
};
window.watchLive = async function(targetId,readOnly) {
  if(!SC.client||!SC.user)return; if(SC.watchMode)await _stopWatching();
  const {data}=await SC.client.from('projects').select('data').eq('id','live_'+targetId).single();
  if (data?.data) _applySnap(data.data);
  SC.watchChannel=SC.client.channel('live_ch_'+targetId,{config:{broadcast:{self:false},presence:{key:SC.user.id}}});
  SC.watchChannel.on('presence',{event:'sync'},()=>_renderOnlineUsers(SC.watchChannel.presenceState()));
  SC.watchChannel.on('broadcast',{event:'full_sync'},({payload})=>_applySnap(payload));
  SC.watchChannel.on('broadcast',{event:'canvas_update'},({payload})=>{if(payload.from!==SC.user?.id)_applySnap(payload);});
  SC.watchChannel.on('broadcast',{event:'cg_update'},({payload})=>{if(payload.from!==SC.user?.id)_applyCGUpdate(payload);});
  SC.watchChannel.on('broadcast',{event:'cursor'},({payload})=>_updateCursor(payload));
  SC.watchChannel.on('broadcast',{event:'note_update'},({payload})=>{if(payload.uid!==SC.user?.id)showNoteOnCanvas(payload.uid,payload.name,payload.color,payload.av,payload.x,payload.y,payload.text);});
  await SC.watchChannel.subscribe(async s=>{if(s==='SUBSCRIBED'){await SC.watchChannel.track({user:SC.user.name,color:SC.user.color,av:SC.user.av});SC.watchChannel.send({type:'broadcast',event:'request_sync',payload:{}});}});
  SC.watchMode=true; SC.watchReadOnly=readOnly===true; SC.watchTarget=targetId;
  const u=TEAM_USERS.find(x=>x.id===targetId);
  _updateLiveUI('watch',(SC.watchReadOnly?'👁 ':'✏️ ')+(u?.name||targetId));
  wsToast((SC.watchReadOnly?'👁 Наблюдаете за ':'✏️ Совм. ред. с ')+(u?.name||targetId),'info');
};
async function _stopWatching(){if(SC.watchChannel){await SC.watchChannel.unsubscribe();SC.watchChannel=null;}SC.watchMode=false;SC.watchReadOnly=false;SC.watchTarget=null;_clearCursors();_updateLiveUI('off','');}
function _updateLiveUI(mode,label){
  const btn=document.getElementById('live-btn'),cb=document.getElementById('copy-local-btn');
  if(mode==='live'){if(btn){btn.textContent='● LIVE';btn.className='cb-btn live';}if(cb)cb.style.display='none';}
  else if(mode==='watch'){if(btn){btn.textContent=label;btn.className='cb-btn watch';}if(cb)cb.style.display='';btn&&(btn.onclick=async()=>{await _stopWatching();btn.onclick=()=>toggleLiveSession();});}
  else{if(btn){btn.textContent='⚡ Live';btn.className='cb-btn';btn.onclick=()=>toggleLiveSession();}if(cb)cb.style.display='none';}
  renderUserBadge();
}
function _startLiveAuto(){SC.liveAutoTimer=setInterval(async()=>{if(!SC.liveMode||!SC.client||!SC.user)return;SC.client.from('projects').update({data:_getSnap(),updated_at:new Date().toISOString()}).eq('id','live_'+SC.user.id);},30000);}
function _stopLiveAuto(){if(SC.liveAutoTimer){clearInterval(SC.liveAutoTimer);SC.liveAutoTimer=null;}}

window.broadcastCanvasUpdate = function() {
  const ch=SC.liveMode?SC.channel:(SC.watchMode&&!SC.watchReadOnly?SC.watchChannel:null);
  if (!ch||!SC.user)return;
  clearTimeout(SC.broadcastTimer);
  SC.broadcastTimer=setTimeout(()=>ch.send({type:'broadcast',event:'canvas_update',payload:{..._getSnap(),from:SC.user.id}}),150);
};
window.broadcastCGUpdate = function(bubbleId) {
  const ch=SC.liveMode?SC.channel:(SC.watchMode&&!SC.watchReadOnly?SC.watchChannel:null);
  if (!ch||!SC.user)return;
  ch.send({type:'broadcast',event:'cg_update',payload:{bubbleId,cgData:window.getBubbleState()?.cgData?.[bubbleId],from:SC.user.id}});
};
function _applyCGUpdate({bubbleId,cgData}){
  if (!bubbleId||!cgData)return;
  const st=window.getBubbleState(); if (!st)return;
  if (!st.cgData) st.cgData={};
  st.cgData[bubbleId]=cgData;
  if (SC.activeCgBubbleId===bubbleId && typeof cgRenderCanvas==='function') cgRenderCanvas();
}

// ── CURSORS & ONLINE USERS ─────────────────────────────────────
function _updateCursor({uid,name,color,av,x,y}){
  if (uid===SC.user?.id)return;
  const wc=window.worldContainer; if (!wc)return;
  const sx=x*wc.scale.x+wc.x, sy=y*wc.scale.y+wc.y;
  let layer=document.getElementById('ws-cursor-layer');
  if (!layer){layer=document.createElement('div');layer.id='ws-cursor-layer';layer.style.cssText='position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:1800;';document.body.appendChild(layer);}
  let cur=SC.liveCursors[uid];
  if (!cur){cur=document.createElement('div');cur.style.cssText='position:absolute;pointer-events:none;transition:left .06s,top .06s;';cur.innerHTML=`<svg width="14" height="20" viewBox="0 0 14 20"><path d="M1 1L1 16L5 12L8 19L10 18L7 11L13 11Z" fill="${color}" stroke="#fff" stroke-width="1"/></svg><div style="background:${color};color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:8px;white-space:nowrap;">${av} ${name}</div>`;layer.appendChild(cur);SC.liveCursors[uid]=cur;}
  cur.style.left=sx+'px';cur.style.top=sy+'px';
}
function _clearCursors(){document.getElementById('ws-cursor-layer')?.remove();SC.liveCursors={};}
function _renderOnlineUsers(st){const c=document.getElementById('online-users');if(!c)return;c.innerHTML=Object.values(st).flat().map(u=>`<span title="${u.user}" style="background:${u.color||'#8b5cf6'};color:#fff;padding:2px 7px;border-radius:10px;font-size:10px;font-weight:700;margin-left:3px;">${u.av||(u.user||'?')[0]}</span>`).join('');}

// ── GLOBAL CHANNEL ─────────────────────────────────────────────
function _joinGlobalChannel(){
  if (!SC.client||!SC.user||SC.globalChannel)return;
  const ch=SC.client.channel('cg_global',{config:{broadcast:{self:false},presence:{key:SC.user.id}}});
  ch.on('presence',{event:'sync'},()=>{const anyLive=Object.values(ch.presenceState()).flat().some(u=>u.live&&u.user!==SC.user?.name);_setLiveDot(anyLive);});
  ch.on('broadcast',{event:'go_live'},({payload})=>{if(payload.uid===SC.user?.id)return;const u=TEAM_USERS.find(x=>x.id===payload.uid);wsToast('● '+(u?.name||payload.uid)+' начал Live!','info');_setLiveDot(true);if(!document.getElementById('ws-cloud-modal')?.classList.contains('hidden'))refreshCloudModal();});
  ch.on('broadcast',{event:'go_offline'},()=>{if(!document.getElementById('ws-cloud-modal')?.classList.contains('hidden'))refreshCloudModal();setTimeout(()=>{if(SC.client)SC.client.from('projects').select('id').eq('live',true).ilike('id','live_%').then(({data})=>_setLiveDot((data||[]).length>0));},2000);});
  ch.subscribe(async s=>{if(s==='SUBSCRIBED')await ch.track({user:SC.user.name,color:SC.user.color,av:SC.user.av,live:SC.liveMode});});
  SC.globalChannel=ch;
}
function _globalBroadcast(ev,p){if(SC.globalChannel)SC.globalChannel.send({type:'broadcast',event:ev,payload:p}).catch(()=>{});}
function _updateGlobalPresence(l){if(SC.globalChannel&&SC.user)SC.globalChannel.track({user:SC.user.name,color:SC.user.color,av:SC.user.av,live:l}).catch(()=>{});}
function _setLiveDot(show){const btn=document.getElementById('btn-cloud');if(!btn)return;let dot=document.getElementById('global-live-dot');if(show){if(!dot){dot=document.createElement('span');dot.id='global-live-dot';dot.style.cssText='position:absolute;top:3px;right:3px;width:7px;height:7px;background:#22c55e;border-radius:50%;border:1.5px solid rgba(15,20,36,.9);pointer-events:none;';btn.style.position='relative';btn.appendChild(dot);}}else dot?.remove();}

// ── NOTES ──────────────────────────────────────────────────────
function _noteKeyHandler(e){
  const tag=document.activeElement?.tagName;
  if (tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
  const noteOpen=document.getElementById('note-overlay')?.style.display!=='none';
  if (noteOpen){if(e.key==='Enter'){e.preventDefault();submitNote();}if(e.key==='Escape')cancelNote();return;}
  if (e.key.toLowerCase()==='e'&&!e.ctrlKey&&!e.altKey&&!e.metaKey){SC.noteMode=true;clearTimeout(SC.noteModeTimer);SC.noteModeTimer=setTimeout(()=>{SC.noteMode=false;},1500);}
  if (e.key==='Enter'&&SC.noteMode){e.preventDefault();SC.noteMode=false;clearTimeout(SC.noteModeTimer);if(SC.notes[SC.user?.id])removeMyNote();else openNoteOverlay();}
}
function openNoteOverlay(){
  const o=document.getElementById('note-overlay'),w=document.getElementById('note-input-wrap'),ta=document.getElementById('note-textarea');
  if (!o||!SC.user)return;
  const scr=SC.lastMouseScr||{x:innerWidth/2,y:innerHeight/2};
  w.style.left=Math.min(scr.x+16,innerWidth-350)+'px';w.style.top=Math.min(scr.y-20,innerHeight-200)+'px';
  if (ta)ta.value='';const cnt=document.getElementById('note-word-count');if(cnt)cnt.textContent='0 слов';
  o.style.display='';setTimeout(()=>ta?.focus(),30);
}
window.submitNote = function(){
  const ta=document.getElementById('note-textarea'),text=ta?.value?.trim();if(!text){cancelNote();return;}
  document.getElementById('note-overlay').style.display='none';if(!SC.user)return;
  SC.notes[SC.user.id]={x:SC.lastCursorX,y:SC.lastCursorY,text};
  showNoteOnCanvas(SC.user.id,SC.user.name,SC.user.color,SC.user.av,SC.lastCursorX+16,SC.lastCursorY,text,true);
  const ch=SC.liveMode?SC.channel:(SC.watchMode?SC.watchChannel:null);
  if (ch)ch.send({type:'broadcast',event:'note_update',payload:{uid:SC.user.id,name:SC.user.name,color:SC.user.color,av:SC.user.av,x:SC.lastCursorX+16,y:SC.lastCursorY,text}});
};
window.cancelNote = function(){document.getElementById('note-overlay').style.display='none';};
window.removeMyNote = function(){
  if(!SC.user)return;delete SC.notes[SC.user.id];document.getElementById('note_'+SC.user.id)?.remove();
  const ch=SC.liveMode?SC.channel:(SC.watchMode?SC.watchChannel:null);
  if(ch)ch.send({type:'broadcast',event:'note_update',payload:{uid:SC.user.id,name:SC.user.name,color:SC.user.color,av:SC.user.av,x:0,y:0,text:''}});
};
window.showNoteOnCanvas = function(uid,name,color,av,x,y,text,isMine){
  let layer=document.getElementById('ws-cursor-layer');
  if(!layer){layer=document.createElement('div');layer.id='ws-cursor-layer';layer.style.cssText='position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:1800;';document.body.appendChild(layer);}
  document.getElementById('note_'+uid)?.remove();if(!text)return;
  const div=document.createElement('div');div.id='note_'+uid;div.style.cssText=`position:absolute;left:${x}px;top:${y}px;pointer-events:${isMine?'auto':'none'};z-index:202;`;
  div.innerHTML=`<div style="background:${color};color:#fff;border-radius:0 9px 9px 9px;padding:6px 10px;max-width:200px;box-shadow:0 3px 10px rgba(0,0,0,.22);font-size:11px;line-height:1.5;"><div style="font-size:9px;font-weight:700;margin-bottom:3px;display:flex;justify-content:space-between;"><span>${av} ${name}</span>${isMine?`<span onclick="removeMyNote()" style="cursor:pointer;opacity:.75;margin-left:8px;">✕</span>`:''}</div><div>${text}</div></div>`;
  layer.appendChild(div);
};

// ── TOAST ──────────────────────────────────────────────────────
window.wsToast = function(msg,type='info'){
  const t=document.getElementById('ws-toast');if(!t)return;
  const bg={success:'#22c55e',error:'#ef4444',warn:'#f59e0b',info:'#3b82f6'};
  t.style.background=bg[type]||bg.info;t.style.color='#fff';t.textContent=msg;
  t.style.opacity='1';t.style.transform='translateY(0)';
  clearTimeout(t._t);t._t=setTimeout(()=>{t.style.opacity='0';t.style.transform='translateY(12px)';},3500);
};

// ── CG WORLD (delegates to workspace_cg.js) ───────────────────
window.createCGWindows = function(bubbleId) {
  if (typeof window.createCGWorldForBubble === 'function') {
    window.createCGWorldForBubble(bubbleId);
  }
};

// Stubs kept to avoid errors from any old HTML onclick references
window.openCGPanel  = function() {};
window.closeCGPanel = function() {};
