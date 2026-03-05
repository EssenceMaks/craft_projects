'use strict';
// ════════════════════════════════════════════════════════════════
// WORKSPACE CG — World-positioned iframe panels
// Each "Создать окна CG" spawns 5 iframes loading coponent_generator.html?tab=N
// positioned in PixiJS world-space, tracking camera via rAF + CSS transform.
// ════════════════════════════════════════════════════════════════

// ── Config ──────────────────────────────────────────────────────
const CG_CFG = {
  MINI_W:   1200,   // each panel width  (world-px)
  MINI_H:   1000,   // each panel height (world-px)
  HEADER_H: 36,     // panel header height (always in CSS px, not scaled)
  GAP:      24,     // gap between panels (world-px)
  OFFSET_Y: 60,     // distance below parent bubble (world-px)
};

const CG_DEFS = [
  { idx:1, icon:'🎨', name:'UI Kit',   color:'#8b5cf6' },
  { idx:2, icon:'📦', name:'Наборы',   color:'#3b82f6' },
  { idx:3, icon:'🔧', name:'Сборка',   color:'#10b981' },
  { idx:4, icon:'📤', name:'Экспорт',  color:'#f59e0b' },
  { idx:5, icon:'🖼', name:'Галерея',  color:'#ec4899' },
];

// ── State ────────────────────────────────────────────────────────
const _cgW = {
  worlds: {},   // bubbleId → { container, bubbleId }
  rafId:  null,
};

// ── Public API ───────────────────────────────────────────────────
window.createCGWorldForBubble = function(bubbleId) {
  const st = window.getBubbleState();
  if (!st) return;
  const b = st.bubbles?.[bubbleId];
  if (!b) return;

  // Tear down previous world for this bubble if any
  _destroyCGWorld(bubbleId);

  const totalW = 5 * CG_CFG.MINI_W + 4 * CG_CFG.GAP;

  // Compute world-space anchor (below & centered on bubble)
  const startWX = b.x + b.size / 2 - totalW / 2;
  const startWY = b.y + b.size + CG_CFG.OFFSET_Y;

  // Layer above canvas (pointer-events passthrough except on panels)
  const layer = _getLayer();

  // ── Outer flex wrapper ──────────────────────────────────────
  const container = document.createElement('div');
  container.className  = 'cgw-wrap';
  container.dataset.bid = bubbleId;
  // Natural size = total world px; transform moves+scales it each frame
  container.style.cssText =
    `position:absolute;left:0;top:0;` +
    `width:${totalW}px;height:${CG_CFG.MINI_H}px;` +
    `transform-origin:0 0;` +
    `display:flex;gap:${CG_CFG.GAP}px;` +
    `pointer-events:none;`;

  CG_DEFS.forEach((tab, _i) => {
    // ── Panel ─────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.style.cssText =
      `display:flex;flex-direction:column;` +
      `width:${CG_CFG.MINI_W}px;height:${CG_CFG.MINI_H}px;flex-shrink:0;` +
      `border-radius:14px;overflow:hidden;` +
      `border:2px solid ${tab.color}55;` +
      `box-shadow:0 16px 56px rgba(0,0,0,.75);` +
      `background:#0b0d17;pointer-events:auto;`;

    // ── Header ────────────────────────────────────────────────
    const hdr = document.createElement('div');
    hdr.style.cssText =
      `height:${CG_CFG.HEADER_H}px;flex-shrink:0;` +
      `background:${tab.color}1a;border-bottom:1px solid ${tab.color}44;` +
      `display:flex;align-items:center;justify-content:space-between;` +
      `padding:0 14px;user-select:none;cursor:default;`;
    hdr.innerHTML =
      `<span style="font-size:13px;font-weight:700;color:${tab.color};">${tab.icon} ${tab.name}</span>` +
      `<button data-close="${bubbleId}" ` +
        `style="background:none;border:none;color:#7a8599;cursor:pointer;` +
               `font-size:16px;line-height:1;padding:2px 6px;border-radius:4px;" ` +
        `title="Закрыть мир CG">✕</button>`;

    // ── iframe ────────────────────────────────────────────────
    const iframe = document.createElement('iframe');
    iframe.src = `coponent_generator.html?tab=${tab.idx}`;
    iframe.style.cssText =
      `flex:1;border:none;width:100%;display:block;`;
    iframe.setAttribute('sandbox',
      'allow-scripts allow-same-origin allow-forms allow-modals allow-downloads');
    iframe.setAttribute('loading', 'lazy');

    panel.appendChild(hdr);
    panel.appendChild(iframe);
    container.appendChild(panel);
  });

  // Close button handler (delegated)
  container.addEventListener('click', e => {
    if (e.target.dataset.close) _destroyCGWorld(e.target.dataset.close);
  });

  layer.appendChild(container);
  _cgW.worlds[bubbleId] = { container, bubbleId, startWX, startWY };

  _startLoop();
  _updatePositions();

  typeof wsToast === 'function' &&
    wsToast('🧩 CG мир открыт — пан/зум для навигации по вкладкам', 'success');
};

window.destroyCGWorld = function(bubbleId) { _destroyCGWorld(bubbleId); };

window.destroyAllCGWorlds = function() {
  Object.keys(_cgW.worlds).forEach(_destroyCGWorld);
};

// ── Internal ─────────────────────────────────────────────────────
function _destroyCGWorld(bubbleId) {
  const inst = _cgW.worlds[bubbleId];
  if (!inst) return;
  inst.container.remove();
  delete _cgW.worlds[bubbleId];
  if (Object.keys(_cgW.worlds).length === 0) {
    cancelAnimationFrame(_cgW.rafId);
    _cgW.rafId = null;
  }
}

function _getLayer() {
  let el = document.getElementById('cg-world-layer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cg-world-layer';
    el.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;' +
      'pointer-events:none;z-index:50;overflow:visible;';
    document.body.appendChild(el);
  }
  return el;
}

function _startLoop() {
  if (_cgW.rafId) return;
  const tick = () => { _updatePositions(); _cgW.rafId = requestAnimationFrame(tick); };
  _cgW.rafId = requestAnimationFrame(tick);
}

function _updatePositions() {
  const wc = window.worldContainer;
  if (!wc) return;
  const scale = wc.scale.x;
  const camX  = wc.x;
  const camY  = wc.y;
  const st    = window.getBubbleState();

  for (const bid in _cgW.worlds) {
    const inst = _cgW.worlds[bid];
    // Track bubble if it moves
    if (st) {
      const b = st.bubbles?.[bid];
      if (b) {
        const totalW = 5 * CG_CFG.MINI_W + 4 * CG_CFG.GAP;
        inst.startWX = b.x + b.size / 2 - totalW / 2;
        inst.startWY = b.y + b.size + CG_CFG.OFFSET_Y;
      }
    }
    const sx = inst.startWX * scale + camX;
    const sy = inst.startWY * scale + camY;
    // translate positions the container; scale makes content zoom with world
    inst.container.style.transform = `translate(${sx}px,${sy}px) scale(${scale})`;
  }
}

// Legacy stub — kept so any lingering references don't crash
window.createDefaultCGData = function() { return {}; };
window.cgRenderCanvas      = function() {};
window.broadcastCGUpdate   = function() {};
window.cgOpenTab           = function() {};

// (legacy functions removed — CG is now rendered in world-positioned iframes)
function getDefaultUIKit() {
  return [
    { id:'atom_btn',    name:'Кнопка',    css:'background:#5e6ad2;color:#fff;padding:10px 24px;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;',    html:'<button>Кнопка</button>',  js:'', group:'Базовые' },
    { id:'atom_inp',    name:'Инпут',     css:'border:1.5px solid #d1d5db;padding:8px 12px;border-radius:8px;font-size:14px;outline:none;width:100%;',                            html:'<input placeholder="Введите текст..." />',  js:'', group:'Базовые' },
    { id:'atom_lbl',    name:'Заголовок', css:'font-size:22px;font-weight:800;color:#1e293b;',                                                                                   html:'<h2>Заголовок</h2>',  js:'', group:'Базовые' },
    { id:'atom_txt',    name:'Текст',     css:'font-size:14px;color:#64748b;line-height:1.6;',                                                                                   html:'<p>Абзац текста</p>',  js:'', group:'Базовые' },
    { id:'atom_card',   name:'Карточка',  css:'background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(0,0,0,.07);',                  html:'<div class="card"><h3>Заголовок</h3><p>Описание карточки</p></div>',  js:'', group:'Контейнеры' },
    { id:'atom_badge',  name:'Бейдж',     css:'background:#dcfce7;color:#166534;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:700;display:inline-block;',       html:'<span>Новый</span>',  js:'', group:'Базовые' },
    { id:'atom_img',    name:'Картинка',  css:'width:100%;height:160px;object-fit:cover;border-radius:8px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;', html:'<img src="https://picsum.photos/300/160" alt="img" />',  js:'', group:'Медиа' },
    { id:'atom_avatar', name:'Аватар',    css:'width:48px;height:48px;border-radius:50%;background:#5e6ad2;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;', html:'<div>AV</div>',  js:'', group:'Базовые' },
    { id:'atom_divider',name:'Разделитель',css:'width:100%;height:1px;background:#e2e8f0;margin:12px 0;',                                                                        html:'<hr />',  js:'', group:'Базовые' },
    { id:'atom_modal',  name:'Модал',     css:'background:#fff;border-radius:16px;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,.18);max-width:380px;width:100%;',             html:'<div><h3>Заголовок</h3><p>Содержимое модала</p><button>Закрыть</button></div>',  js:'', group:'Контейнеры' },
    { id:'atom_nav',    name:'Навбар',    css:'background:#1e293b;color:#fff;padding:12px 24px;display:flex;align-items:center;gap:24px;',                                       html:'<nav><span>Лого</span><a href="#">Раздел 1</a><a href="#">Раздел 2</a></nav>',  js:'', group:'Навигация' },
    { id:'atom_select', name:'Выбор',     css:'border:1.5px solid #d1d5db;padding:8px 12px;border-radius:8px;font-size:14px;background:#fff;',                                  html:'<select><option>Опция 1</option><option>Опция 2</option></select>',  js:'', group:'Базовые' },
  ];
}

// Helper: get active CG state
function _S() {
  const st = window.getBubbleState();
  const bid = window.SC?.activeCgBubbleId;
  if (!st||!bid) return null;
  if (!st.cgData) st.cgData = {};
  if (!st.cgData[bid]) st.cgData[bid] = createDefaultCGData();
  return st.cgData[bid];
}

// ── Open tab (called by openCGPanel) ───────────────────────────
window.cgOpenTab = function(bubbleId, tabIdx) {
  window.SC.activeCgBubbleId = bubbleId;
  switch (tabIdx) {
    case 1: cgRenderUIKit(); break;
    case 2: cgRenderSets(); break;
    case 3: cgRenderCanvas(); break;
    case 4: cgRefreshExport(); break;
    case 5: cgRenderGallery(); break;
  }
};

// ════════════════════════════════════════════════════════════════
// TAB 1 — UI Kit
// ════════════════════════════════════════════════════════════════
window.cgUIKitTab = function(view) {
  ['atoms','comps','newset'].forEach(v => {
    const el = document.getElementById('cg-uikit-'+v+'-view'); if (el) el.style.display = v===view?'':'none';
    const btn = document.getElementById('cg-uikit-tab-'+v); if (btn) btn.classList.toggle('active', v===view);
  });
  if (view==='atoms') cgRenderUIKit();
  else if (view==='comps') cgRenderComps();
};

function cgRenderUIKit() {
  const S = _S(); if (!S) return;
  const wrap = document.getElementById('cg-atom-grid-wrap'); if (!wrap) return;
  const groups = {};
  (S.uiKit||[]).forEach(a => { if (!groups[a.group]) groups[a.group]=[]; groups[a.group].push(a); });
  wrap.innerHTML = Object.entries(groups).map(([grp, atoms]) => `
    <div class="cg-group-title">${grp}</div>
    <div class="cg-atom-grid">
      ${atoms.map(a => `
        <div class="cg-atom" draggable="true" data-atom-id="${a.id}"
          ondragstart="cgDragAtom(event,'${a.id}')"
          onclick="cgAddAtomToCanvas('${a.id}')">
          <div style="font-size:18px;line-height:1;">${_atomPreviewIcon(a)}</div>
          <div class="cg-atom-label">${a.name}</div>
        </div>`).join('')}
    </div>`).join('');
}

function _atomPreviewIcon(a) {
  if (a.html.includes('<button')) return '🔲';
  if (a.html.includes('<input')) return '📝';
  if (a.html.includes('<h2')||a.html.includes('<h3')) return '📌';
  if (a.html.includes('<img')) return '🖼';
  if (a.html.includes('<nav')) return '🧭';
  if (a.html.includes('<hr')) return '─';
  return '📦';
}

function cgRenderComps() {
  const S = _S(); if (!S) return;
  const grid = document.getElementById('cg-comps-grid'); if (!grid) return;
  grid.innerHTML = (S.comps||[]).length === 0
    ? '<div style="color:#7a8599;font-size:11px;padding:8px;">Нет сохранённых композиций</div>'
    : (S.comps||[]).map(c => `
      <div class="cg-atom" onclick="cgLoadComp('${c.id}')">
        <div style="font-size:22px;">📐</div>
        <div class="cg-atom-label">${c.name}</div>
      </div>`).join('');
}

window.cgDragAtom = function(event, atomId) {
  event.dataTransfer.setData('text/plain', 'atom:'+atomId);
};

window.cgAddAtomToCanvas = function(atomId) {
  const S = _S(); if (!S) return;
  const atom = (S.uiKit||[]).find(a=>a.id===atomId); if (!atom) return;
  const id = 'item_'+Math.random().toString(36).substr(2,7);
  const ca = document.getElementById('cg-ca');
  const wrap = document.getElementById('cg-canvas-wrap');
  const scrollX = wrap ? wrap.scrollLeft + 100 : 100;
  const scrollY = wrap ? wrap.scrollTop + 100 : 100;
  S.items.push({ id, x:scrollX, y:scrollY, w:180, h:80, css:atom.css, html:atom.html, js:atom.js, isCopy:false, parentCopyId:null });
  cgRenderCanvas(); cgRenderCanvas(); // render twice to init DOM then update
  broadcastCGUpdate(window.SC.activeCgBubbleId);
};

// ════════════════════════════════════════════════════════════════
// TAB 2 — Sets
// ════════════════════════════════════════════════════════════════
function cgRenderSets() {
  const S = _S(); if (!S) return;
  const sel = document.getElementById('cg-set-select'); if (!sel) return;
  sel.innerHTML = (S.sets||[]).length===0
    ? '<option value="">— нет наборов —</option>'
    : (S.sets||[]).map(s=>`<option value="${s.id}">${s.name} (${s.atoms?.length||0} эл.)</option>`).join('');
  cgSetChanged();
}
window.cgSetChanged = function() {
  const S = _S(); if (!S) return;
  const sid = document.getElementById('cg-set-select')?.value;
  const set = (S.sets||[]).find(s=>s.id===sid);
  const preview = document.getElementById('cg-set-preview'); if (!preview) return;
  if (!set) { preview.innerHTML = '<div style="color:#7a8599;font-size:11px;">Выберите набор</div>'; return; }
  preview.innerHTML = (set.atoms||[]).map(aid => {
    const a = (S.uiKit||[]).find(x=>x.id===aid);
    return a ? `<div class="cg-atom"><div style="font-size:18px;">${_atomPreviewIcon(a)}</div><div class="cg-atom-label">${a.name}</div></div>` : '';
  }).join('');
};
window.cgTransferSet = function() {
  const S = _S(); if (!S) return;
  const sid = document.getElementById('cg-set-select')?.value;
  const set = (S.sets||[]).find(s=>s.id===sid); if (!set) { wsToast('Выберите набор','warn'); return; }
  let x = 60, y = 60;
  (set.atoms||[]).forEach(aid => {
    const atom = (S.uiKit||[]).find(a=>a.id===aid); if (!atom) return;
    const id = 'item_'+Math.random().toString(36).substr(2,7);
    S.items.push({ id, x, y, w:180, h:80, css:atom.css, html:atom.html, js:atom.js, isCopy:false, parentCopyId:null });
    x += 200;
    if (x > 1400) { x=60; y+=120; }
  });
  cgRenderCanvas(); openCGPanel(window.SC.activeCgBubbleId, 3);
  broadcastCGUpdate(window.SC.activeCgBubbleId); wsToast('Перенесено на холст','success');
};
window.cgCreateSet = function() {
  const S = _S(); if (!S) return;
  const sel = S.selIds||[];
  if (!sel.length) { wsToast('Выделите элементы на холсте','warn'); return; }
  const name = prompt('Название набора:','Набор '+(S.sets.length+1)); if (!name) return;
  const id = 'set_'+Math.random().toString(36).substr(2,7);
  S.sets.push({ id, name, atoms: sel });
  cgRenderSets(); wsToast('Набор создан: '+name,'success');
  broadcastCGUpdate(window.SC.activeCgBubbleId);
};

// ════════════════════════════════════════════════════════════════
// TAB 3 — Assembly Canvas
// ════════════════════════════════════════════════════════════════
window.cgRenderCanvas = function() {
  const S = _S(); if (!S) return;
  const cvf = document.getElementById('cg-cvf'); if (!cvf) return;

  // Remove stale item divs
  const existingIds = new Set((S.items||[]).map(it=>it.id));
  Array.from(cvf.querySelectorAll('.cg-item')).forEach(el => { if (!existingIds.has(el.dataset.id)) el.remove(); });

  (S.items||[]).forEach(item => {
    let el = cvf.querySelector(`.cg-item[data-id="${item.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'cg-item';
      el.dataset.id = item.id;
      el.innerHTML = `<div class="cg-item-inner" style="pointer-events:none;width:100%;height:100%;overflow:hidden;"></div><div class="cg-resize-handle" data-id="${item.id}"></div>`;
      if (item.isCopy) { const badge=document.createElement('div');badge.className='cg-copy-badge';badge.textContent='#';el.appendChild(badge); }
      cvf.appendChild(el);
      _cgBindItemEvents(el, item.id);
    }
    el.style.left = item.x+'px'; el.style.top = item.y+'px';
    el.style.width = item.w+'px'; el.style.height = item.h+'px';
    el.classList.toggle('selected', S.selId===item.id || (S.selIds||[]).includes(item.id));
    // Render inner content
    const inner = el.querySelector('.cg-item-inner');
    if (inner) {
      inner.innerHTML = item.html||'';
      const styleId = 'cg-style-'+item.id;
      let styleEl = document.getElementById(styleId);
      if (!styleEl) { styleEl=document.createElement('style'); styleEl.id=styleId; document.head.appendChild(styleEl); }
      styleEl.textContent = `[data-id="${item.id}"] .cg-item-inner > * { ${item.css||''} }`;
    }
  });

  // Render SVG arrows
  cgRenderArrows();
  // Update props sidebar if open
  if (document.getElementById('cg-props-sidebar')?.classList.contains('open')) cgUpdatePropsSidebar();
};

function _cgBindItemEvents(el, id) {
  el.addEventListener('pointerdown', e => {
    if (e.target.classList.contains('cg-resize-handle')) { _cgStartResize(e,id); return; }
    e.stopPropagation();
    const S = _S(); if (!S) return;
    if (e.shiftKey) {
      const idx = (S.selIds||[]).indexOf(id);
      if (idx>=0) S.selIds.splice(idx,1); else { if(!S.selIds) S.selIds=[]; S.selIds.push(id); }
    } else {
      S.selId=id; S.selIds=[id]; S.selIsCopy=S.items.find(i=>i.id===id)?.isCopy||false; S.selConnId=null;
    }
    cgRenderCanvas(); cgUpdatePropsSidebar();
    _cgStartDrag(e, id);
  });
}

function _cgStartDrag(e, id) {
  const S = _S(); if (!S) return;
  const item = S.items.find(i=>i.id===id); if (!item) return;
  const ox=e.clientX, oy=e.clientY, ix=item.x, iy=item.y;
  const onMove = ev => { item.x=ix+(ev.clientX-ox); item.y=iy+(ev.clientY-oy); cgRenderCanvas(); };
  const onUp = () => { document.removeEventListener('pointermove',onMove); document.removeEventListener('pointerup',onUp); broadcastCGUpdate(window.SC.activeCgBubbleId); };
  document.addEventListener('pointermove',onMove); document.addEventListener('pointerup',onUp);
}

function _cgStartResize(e, id) {
  e.stopPropagation();
  const S = _S(); if (!S) return;
  const item = S.items.find(i=>i.id===id); if (!item) return;
  const ox=e.clientX, oy=e.clientY, iw=item.w, ih=item.h;
  const onMove = ev => { item.w=Math.max(60,iw+(ev.clientX-ox)); item.h=Math.max(30,ih+(ev.clientY-oy)); cgRenderCanvas(); };
  const onUp = () => { document.removeEventListener('pointermove',onMove); document.removeEventListener('pointerup',onUp); broadcastCGUpdate(window.SC.activeCgBubbleId); };
  document.addEventListener('pointermove',onMove); document.addEventListener('pointerup',onUp);
}

// Canvas drop from UI Kit (DOM already loaded — scripts are at bottom of body)
(function bindCGCanvasDrop() {
  const wrap = document.getElementById('cg-canvas-wrap'); if (!wrap) return;
  wrap.addEventListener('dragover', e => e.preventDefault());
  wrap.addEventListener('drop', e => {
    e.preventDefault();
    const data = e.dataTransfer.getData('text/plain');
    if (!data.startsWith('atom:')) return;
    const atomId = data.slice(5);
    const S = _S(); if (!S) return;
    const atom = (S.uiKit||[]).find(a=>a.id===atomId); if (!atom) return;
    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left + wrap.scrollLeft - 80;
    const y = e.clientY - rect.top + wrap.scrollTop - 30;
    const id = 'item_'+Math.random().toString(36).substr(2,7);
    S.items.push({ id, x:Math.max(0,x), y:Math.max(0,y), w:180, h:80, css:atom.css, html:atom.html, js:atom.js, isCopy:false, parentCopyId:null });
    cgRenderCanvas(); broadcastCGUpdate(window.SC.activeCgBubbleId);
  });
})();

// Click empty canvas to deselect
document.getElementById('cg-cvf')?.addEventListener('pointerdown', e => {
  if (e.target === document.getElementById('cg-cvf') || e.target === document.getElementById('cg-ca')) {
    const S = _S(); if (S) { S.selId=null; S.selIds=[]; S.selConnId=null; cgRenderCanvas(); }
  }
});

// Arrows
function cgRenderArrows() {
  const S = _S(); if (!S) return;
  const svg = document.getElementById('cg-svg-overlay'); if (!svg) return;
  const existingPaths = new Set((S.connections||[]).map(c=>c.id));
  Array.from(svg.querySelectorAll('[data-conn-id]')).forEach(el=>{ if(!existingPaths.has(el.getAttribute('data-conn-id'))) el.remove(); });
  (S.connections||[]).forEach(conn => {
    const fromItem = S.items.find(i=>i.id===conn.from);
    const toItem = S.items.find(i=>i.id===conn.to);
    if (!fromItem||!toItem) return;
    const x1=fromItem.x+fromItem.w/2, y1=fromItem.y+fromItem.h/2;
    const x2=toItem.x+toItem.w/2, y2=toItem.y+toItem.h/2;
    const mx=(x1+x2)/2, my=(y1+y2)/2;
    const id='path_'+conn.id;
    let path = svg.querySelector(`[data-conn-id="${conn.id}"]`);
    if (!path) {
      path = document.createElementNS('http://www.w3.org/2000/svg','g');
      path.setAttribute('data-conn-id',conn.id);
      path.addEventListener('click',e=>{ e.stopPropagation(); const s=_S();if(s){s.selConnId=conn.id;s.selId=null;s.selIds=[];cgRenderCanvas();} });
      svg.appendChild(path);
    }
    const isSelConn = S.selConnId===conn.id;
    const color = conn.color||'#8b5cf6';
    const cx1=x1+(x2-x1)*.25, cy1=y1-(Math.abs(y2-y1)*0.4||30);
    const cx2=x2-(x2-x1)*.25, cy2=y2-(Math.abs(y2-y1)*0.4||30);
    path.innerHTML = `
      <path d="M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}" stroke="${color}" stroke-width="${isSelConn?3:1.5}" fill="none" marker-end="url(#cg-arrowhead)" stroke-dasharray="${isSelConn?'6,3':''}"/>
      ${conn.label?`<text x="${mx}" y="${my-8}" fill="${color}" font-size="10" text-anchor="middle">${conn.label}</text>`:''}`;
  });
}

window.cgAnimate = function() {
  const S = _S(); if (!S) return;
  const selItems = S.selIds?.length ? S.selIds : (S.selId ? [S.selId] : []);
  if (selItems.length < 2) { wsToast('Выделите ≥2 элемента для анимации','warn'); return; }
  const base = selItems[0];
  selItems.slice(1).forEach(sid => {
    const src = S.items.find(i=>i.id===base); const tgt=S.items.find(i=>i.id===sid);
    if (!src||!tgt) return;
    // Create copy of source offset to target position
    const copyId='item_'+Math.random().toString(36).substr(2,7);
    S.items.push({id:copyId,x:tgt.x+tgt.w+30,y:tgt.y,w:src.w,h:src.h,css:src.css,html:src.html,js:src.js,isCopy:true,parentCopyId:base});
    const connId='conn_'+Math.random().toString(36).substr(2,7);
    S.connections.push({id:connId,from:sid,to:copyId,label:'→',color:'#8b5cf6'});
  });
  cgRenderCanvas(); broadcastCGUpdate(window.SC.activeCgBubbleId); wsToast('Анимационные копии созданы','success');
};

window.cgToggleMulti = function() {
  const btn = document.getElementById('cg-multi-sel-btn'); if (btn) btn.classList.toggle('active');
};

window.cgClearCanvas = function() {
  if (!confirm('Очистить холст?')) return;
  const S = _S(); if (!S) return;
  S.items=[]; S.connections=[]; S.selId=null; S.selIds=[]; S.selConnId=null;
  // Remove stale style tags
  document.querySelectorAll('[id^="cg-style-"]').forEach(el=>el.remove());
  cgRenderCanvas(); broadcastCGUpdate(window.SC.activeCgBubbleId);
};

window.cgToggleProps = function() {
  const sidebar = document.getElementById('cg-props-sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('open');
  document.getElementById('cg-props-toggle-btn')?.classList.toggle('active', sidebar.classList.contains('open'));
  if (sidebar.classList.contains('open')) cgUpdatePropsSidebar();
};

function cgUpdatePropsSidebar() {
  const S = _S(); if (!S) return;
  const item = S.items.find(i=>i.id===S.selId);
  if (!item) { document.getElementById('cg-props-sidebar')?.classList.remove('open'); return; }
  document.getElementById('cg-props-sidebar')?.classList.add('open');
  const css = document.getElementById('cg-prop-css'); if (css) css.value = item.css||'';
  const html = document.getElementById('cg-prop-html'); if (html) html.value = item.html||'';
  const js = document.getElementById('cg-prop-js'); if (js) js.value = item.js||'';
  _renderBoxModel(item);
}

function _renderBoxModel(item) {
  const el = document.getElementById('cg-box-model'); if (!el) return;
  el.innerHTML = `
    <div style="position:relative;border:2px solid #3b82f6;border-radius:4px;padding:10px;font-size:9px;color:#7a8599;text-align:center;">
      MARGIN<div style="border:2px solid #f59e0b;border-radius:3px;padding:8px;margin-top:4px;color:#f59e0b;">
        BORDER<div style="border:2px dashed #22c55e;border-radius:3px;padding:6px;margin-top:4px;color:#22c55e;">
          PADDING<div style="border:1px solid #8b5cf6;padding:4px;margin-top:4px;color:#8b5cf6;font-weight:700;">
            ${item.w}×${item.h}px
          </div>
        </div>
      </div>
    </div>`;
}

window.cgApplyCSS = function() {
  const S = _S(); if (!S) return;
  const item = S.items.find(i=>i.id===S.selId); if (!item) return;
  item.css = document.getElementById('cg-prop-css')?.value||'';
  cgRenderCanvas(); broadcastCGUpdate(window.SC.activeCgBubbleId);
};
window.cgApplyHTML = function() {
  const S = _S(); if (!S) return;
  const item = S.items.find(i=>i.id===S.selId); if (!item) return;
  item.html = document.getElementById('cg-prop-html')?.value||'';
  cgRenderCanvas(); broadcastCGUpdate(window.SC.activeCgBubbleId);
};
window.cgApplyJS = function() {
  const S = _S(); if (!S) return;
  const item = S.items.find(i=>i.id===S.selId); if (!item) return;
  item.js = document.getElementById('cg-prop-js')?.value||'';
  broadcastCGUpdate(window.SC.activeCgBubbleId);
};

// Show preview in panel
window.cgShowPreview = function() {
  const S = _S(); if (!S) return;
  const item = S.items.find(i=>i.id===S.selId);
  if (!item) { wsToast('Выберите элемент','warn'); return; }
  const win = window.open('','_blank','width=600,height=400');
  win.document.write(`<!DOCTYPE html><html><head><style>body{margin:20px;font-family:Segoe UI,sans-serif;}</style></head><body><style>${_cleanCss(item.css)}</style>${item.html}<script>${item.js||''}<\/script></body></html>`);
  win.document.close();
};

// ════════════════════════════════════════════════════════════════
// TAB 4 — Export
// ════════════════════════════════════════════════════════════════
window.cgRefreshExport = function() {
  const S = _S(); if (!S) return;
  const iframe = document.getElementById('cg-export-preview'); if (!iframe) return;
  const allCSS = (S.items||[]).map(item=>`/* ${item.id} */\n${_cleanCss(item.css)}`).join('\n\n');
  const allHTML = (S.items||[]).map(item=>item.html||'').join('\n');
  iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{margin:16px;font-family:Segoe UI,sans-serif;background:#f8fafc;}${allCSS}</style></head><body>${allHTML}</body></html>`;
};

window.cgDownloadHTML = function() {
  const S = _S(); if (!S) return;
  const allCSS = (S.items||[]).map(item=>`/* ${item.id} */\n${_cleanCss(item.css)}`).join('\n\n');
  const allHTML = (S.items||[]).map(item=>item.html||'').join('\n');
  const full = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Exported Component</title>
<style>
body { margin: 20px; font-family: Segoe UI, Tahoma, sans-serif; background: #f8fafc; }
${allCSS}
</style>
</head>
<body>
${allHTML}
</body>
</html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([full],{type:'text/html'}));
  a.download = 'component_'+(window.SC.activeCgBubbleId||'export')+'.html';
  a.click(); URL.revokeObjectURL(a.href);
  wsToast('HTML скачан','success');
};

window.cgSaveComp = function() {
  const S = _S(); if (!S) return;
  const name = prompt('Название композиции:','Компонент '+(S.comps.length+1)); if (!name) return;
  const id = 'comp_'+Math.random().toString(36).substr(2,7);
  S.comps.push({ id, name, items:JSON.parse(JSON.stringify(S.items)), connections:JSON.parse(JSON.stringify(S.connections)), ts:Date.now() });
  wsToast('Сохранено: '+name,'success'); broadcastCGUpdate(window.SC.activeCgBubbleId);
};

window.cgLoadComp = function(compId) {
  const S = _S(); if (!S) return;
  const comp = (S.comps||[]).find(c=>c.id===compId); if (!comp) return;
  if (!confirm('Загрузить «'+comp.name+'»? Текущий холст будет заменён.')) return;
  S.items = JSON.parse(JSON.stringify(comp.items));
  S.connections = JSON.parse(JSON.stringify(comp.connections));
  S.selId=null; S.selIds=[]; S.selConnId=null;
  cgRenderCanvas(); openCGPanel(window.SC.activeCgBubbleId, 3);
  broadcastCGUpdate(window.SC.activeCgBubbleId); wsToast('Загружено: '+comp.name,'success');
};

// Web Component export (Shadow DOM)
window.cgExportWebComponent = function() {
  const S = _S(); if (!S) return;
  const allCSS = (S.items||[]).map(item=>_cleanCss(item.css)).join('\n');
  const allHTML = (S.items||[]).map(item=>item.html||'').join('\n');
  const tagName = 'ws-component-'+Math.random().toString(36).substr(2,5);
  const wc = `class ${tagName.replace(/-/g,'_')} extends HTMLElement {
  constructor(){super();const shadow=this.attachShadow({mode:'open'});const style=document.createElement('style');style.textContent=\`${allCSS}\`;const div=document.createElement('div');div.innerHTML=\`${allHTML}\`;shadow.appendChild(style);shadow.appendChild(div);}
}
customElements.define('${tagName}',${tagName.replace(/-/g,'_')});`;
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([wc],{type:'text/javascript'}));a.download=tagName+'.js';a.click();URL.revokeObjectURL(a.href);
  wsToast('Web Component экспортирован','success');
};

// ════════════════════════════════════════════════════════════════
// TAB 5 — Gallery
// ════════════════════════════════════════════════════════════════
function cgRenderGallery() {
  const S = _S(); if (!S) return;
  const grid = document.getElementById('cg-gallery-grid'); if (!grid) return;
  if (!(S.comps||[]).length) {
    grid.innerHTML = '<div style="color:#7a8599;font-size:11px;padding:8px;grid-column:1/-1;">Нет сохранённых композиций.<br>Сохрани их на вкладке Экспорт.</div>';
    return;
  }
  grid.innerHTML = (S.comps||[]).sort((a,b)=>b.ts-a.ts).map(c=>`
    <div style="border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:8px;background:rgba(255,255,255,.03);cursor:pointer;" onclick="cgLoadComp('${c.id}')">
      <div style="font-size:22px;text-align:center;margin-bottom:6px;">📐</div>
      <div style="font-size:10px;font-weight:700;color:#e0e6ed;text-align:center;">${c.name}</div>
      <div style="font-size:9px;color:#7a8599;text-align:center;margin-top:3px;">${c.items?.length||0} эл.</div>
      <div style="display:flex;gap:4px;margin-top:6px;justify-content:center;">
        <button class="cg-tb-btn" style="font-size:9px;padding:2px 6px;" onclick="event.stopPropagation();cgLoadComp('${c.id}')">↩ Загрузить</button>
        <button class="cg-tb-btn" style="font-size:9px;padding:2px 6px;color:#f87171;" onclick="event.stopPropagation();cgDeleteComp('${c.id}')">✕</button>
      </div>
    </div>`).join('');
}

window.cgDeleteComp = function(compId) {
  const S = _S(); if (!S||!confirm('Удалить?')) return;
  S.comps = (S.comps||[]).filter(c=>c.id!==compId);
  cgRenderGallery(); broadcastCGUpdate(window.SC.activeCgBubbleId);
};

// ── Helpers ────────────────────────────────────────────────────
function _cleanCss(css) {
  if (!css) return '';
  // Remove position:absolute / left: / top: for standalone display
  return css.replace(/position\s*:\s*absolute\s*;?/g,'').replace(/\b(left|top|right|bottom)\s*:\s*[\d.]+px\s*;?/g,'');
}
