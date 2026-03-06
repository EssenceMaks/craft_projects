// NEON BUBBLES PRO — PixiJS GPU Engine
const escapeHTML = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const generateId = () => '_' + Math.random().toString(36).substr(2, 9);
const pixiCanvas = document.getElementById('pixi-canvas');
const app = new PIXI.Application({ view: pixiCanvas, width: innerWidth, height: innerHeight, backgroundColor: 0x0b0d17, antialias: true, resolution: devicePixelRatio || 1, autoDensity: true });
const layerBg = new PIXI.Container(), layerGlow = new PIXI.Container(), layerLines = new PIXI.Container();
const layerPart = new PIXI.Container(), layerLbl = new PIXI.Container(), layerBub = new PIXI.Container(), layerHit = new PIXI.Container(), layerPts = new PIXI.Container();
layerPart.eventMode = 'none'; layerPart.interactiveChildren = false;
layerLbl.eventMode = 'none'; layerLbl.interactiveChildren = false;
layerGlow.eventMode = 'none'; layerGlow.interactiveChildren = false;
layerBg.eventMode = 'none'; layerBg.interactiveChildren = false;
layerLines.eventMode = 'none'; layerLines.interactiveChildren = false;
const worldContainer = new PIXI.Container();
window.worldContainer = worldContainer; // exposed for workspace_engine.js

// Authentication State & DB
const USERS_DB = [
    { id: 'admin', name: 'Админ', pin: '000000', color: '#ff0066', icon: '👤', avatar: 'A', emoji: '👑' },
    { id: 'user1', name: 'Игрок 1', pin: '111111', color: '#00ccff', icon: '🎮', avatar: '1', emoji: '⚡' },
    { id: 'user2', name: 'Игрок 2', pin: '222222', color: '#00ffcc', icon: '🎭', avatar: '2', emoji: '🔥' }
];
let currentUser = null;
let currentPinInput = '';
let activeUserForPin = null;

// External auth hook — called by workspace_engine.js after Supabase login
window._bubbleSetUser = function(user) {
    currentUser = user;
    let tbl = document.getElementById('toolbar');
    let mhd = document.getElementById('minimap-hud');
    if (tbl) tbl.style.display = user ? 'flex' : 'none';
    if (mhd) { if (user) { minimapVisible = true; mhd.style.display = 'block'; } else { minimapVisible = false; mhd.style.display = 'none'; } }
    if (typeof queueRender === 'function') queueRender();
};
// Allow workspace_engine.js to inject CG context menu items
window._cgContextMenuHook = null;

function renderUserGrid() {
    const grid = document.getElementById('user-grid');
    if (!grid) return;
    grid.innerHTML = '';
    USERS_DB.forEach(u => {
        let card = document.createElement('div');
        card.className = 'user-card';
        card.innerHTML = `
            <div class="user-avatar" style="background:${u.color};">${u.avatar}</div>
            <div class="user-name">${u.icon} ${u.name} ${u.emoji}</div>
        `;
        card.onclick = () => showPinScreen(u);
        grid.appendChild(card);
    });
}

function showPinScreen(user) {
    activeUserForPin = user;
    currentPinInput = '';
    updatePinDots();
    document.getElementById('user-screen').style.display = 'none';
    document.getElementById('pin-screen').style.display = 'flex';
    document.getElementById('pin-user-name').innerText = `PIN для ${user.name}`;
    let avatarEl = document.getElementById('pin-user-avatar');
    avatarEl.innerText = user.avatar;
    avatarEl.style.background = user.color;
    document.getElementById('pin-error').style.visibility = 'hidden';
}

document.getElementById('btn-back-users')?.addEventListener('click', () => {
    activeUserForPin = null;
    document.getElementById('pin-screen').style.display = 'none';
    document.getElementById('user-screen').style.display = 'block';
});

window.enterPin = function (num) {
    if (currentPinInput.length >= 6) return;
    currentPinInput += num.toString();
    updatePinDots();

    if (currentPinInput.length === 6) {
        setTimeout(verifyPin, 100);
    }
}

window.clearPin = function () {
    currentPinInput = '';
    updatePinDots();
    document.getElementById('pin-error').style.visibility = 'hidden';
}

function updatePinDots() {
    let dots = document.querySelectorAll('.pin-dot');
    dots.forEach((dot, i) => {
        if (i < currentPinInput.length) dot.classList.add('filled');
        else dot.classList.remove('filled');
    });
}

function verifyPin() {
    let err = document.getElementById('pin-error');
    if (currentPinInput === activeUserForPin.pin) {
        // Success
        currentUser = activeUserForPin;
        document.getElementById('login-overlay').style.opacity = '0';
        setTimeout(() => {
            document.getElementById('login-overlay').style.display = 'none';
            // Reveal UI
            document.getElementById('toolbar').style.display = 'flex';
            if (minimapHud && minimapVisible) minimapHud.style.display = 'block';
        }, 500);
    } else {
        // Fail
        err.style.visibility = 'visible';
        let pinPad = document.querySelector('.pin-pad');
        pinPad.classList.remove('pin-shake');
        void pinPad.offsetWidth; // trigger reflow
        pinPad.classList.add('pin-shake');

        setTimeout(() => {
            currentPinInput = '';
            updatePinDots();
        }, 400);
    }
}

// Init Login UI
renderUserGrid();
if (!currentUser) {
    document.getElementById('toolbar').style.display = 'none';
    if (document.getElementById('minimap-hud')) document.getElementById('minimap-hud').style.display = 'none';
}

let selectedBubbles = new Set();
let selectionBox = new PIXI.Graphics();
layerHit.addChild(selectionBox);

worldContainer.addChild(layerBg, layerGlow, layerLines, layerPart, layerLbl, layerHit, layerBub, layerPts);
app.stage.addChild(worldContainer);
app.stage.eventMode = 'static'; app.stage.hitArea = app.screen;
window.addEventListener('resize', () => { app.renderer.resize(innerWidth, innerHeight); app.stage.hitArea = app.screen; queueRender(); });

window.requestAnimationFrame = window.requestAnimationFrame || window.webkitRequestAnimationFrame;

// Keyboard State for WASD
const keys = { w: false, a: false, s: false, d: false };
window.addEventListener('keydown', e => {
    if (!currentUser) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    let c = e.code;
    if (c === 'KeyW') keys.w = true;
    if (c === 'KeyA') keys.a = true;
    if (c === 'KeyS') keys.s = true;
    if (c === 'KeyD') keys.d = true;
    if (keys.w || keys.a || keys.s || keys.d) queueRender();
});
window.addEventListener('keyup', e => {
    if (!currentUser) return;
    let c = e.code;
    if (c === 'KeyW') keys.w = false;
    if (c === 'KeyA') keys.a = false;
    if (c === 'KeyS') keys.s = false;
    if (c === 'KeyD') keys.d = false;
    queueRender();
});

// Wheel Zoom State
const ZOOM_MIN = 0.05, ZOOM_MAX = 5.0;
window.addEventListener('wheel', e => {
    if (!currentUser) return;
    if (e.target !== pixiCanvas) return;
    e.preventDefault();
    if (dragState || cam.isPanningMMB) return;

    // Zoom factor
    let zoomIntensity = 0.001;
    let delta = -e.deltaY;
    let newScale = Math.min(Math.max(worldContainer.scale.x + delta * zoomIntensity, ZOOM_MIN), ZOOM_MAX);

    // Calculate position to zoom into cursor
    let pointerX = e.clientX;
    let pointerY = e.clientY;

    // Pointer in world space before zoom
    let worldX = (pointerX - worldContainer.x) / worldContainer.scale.x;
    let worldY = (pointerY - worldContainer.y) / worldContainer.scale.y;

    // Apply new scale
    worldContainer.scale.set(newScale);

    // Reposition world container so cursor is in the same world position
    worldContainer.x = pointerX - worldX * newScale;
    worldContainer.y = pointerY - worldY * newScale;

    // Apply camera bounds after zoom
    if (typeof applyCameraBounds === 'function') applyCameraBounds();

    queueRender();
}, { passive: false });

// Global Pointer tracking for Edge Panning
let globalMouse = { x: innerWidth / 2, y: innerHeight / 2 };
window.addEventListener('pointermove', e => {
    if (!currentUser) return;
    globalMouse.x = e.clientX; globalMouse.y = e.clientY;
});

let state = window.APP_STATE || { bubbles: {}, minis: {}, links: {}, points: {} };
if (!state.globalAnimConfig) state.globalAnimConfig = { mode: 'pixi_dash', shape: 'drop', size: 1, count: 1, wobble: 0, emojis: '❤️⭐✨', hideLines: false, ecoMode: false, hasGlow: true };
if (state.animationMode === undefined) state.animationMode = 'play';
if (!state.cgData) state.cgData = {}; // CG workspaces per bubble
let defaultLP = { type: 'sharp', lineMode: 'single', color: '#00ffcc' };
if (!state.points) state.points = {}; if (!state.bubbles) state.bubbles = {}; if (!state.minis) state.minis = {};
// Expose state access for workspace_engine.js
window.getBubbleState = () => state;
window.setBubbleState = (s) => { state = s; if (!state.cgData) state.cgData = {}; };

// Migrate links
let la = Array.isArray(state.links) ? state.links : Object.values(state.links || {});
let nl = {};
la.forEach(l => {
    if (!l) return;
    const mp = d => { let id = 'p_' + generateId(); state.points[id] = d; return id; };
    if (typeof l.from !== 'string' || !l.from.startsWith('p_')) l.from = mp(typeof l.from === 'object' ? { x: l.from.x || 0, y: l.from.y || 0, attachedTo: null, angle: null } : { attachedTo: l.from, angle: null });
    if (typeof l.to !== 'string' || !l.to.startsWith('p_')) l.to = mp(typeof l.to === 'object' ? { x: l.to.x || 0, y: l.to.y || 0, attachedTo: null, angle: null } : { attachedTo: l.to, angle: null });
    l.waypoints = (l.waypoints || []).map(w => (typeof w === 'string' && w.startsWith('p_')) ? w : mp({ x: w.x || 0, y: w.y || 0, attachedTo: null, angle: null }));
    if (l.hasGlow === undefined) { l.hasGlow = true; l.glowOpacity = 0.3; }
    if (l.labels === undefined) { l.labels = []; if (l.name) { l.labels.push({ id: 'lbl_' + generateId(), text: l.name, type: 'along', offset: 0.5 }); delete l.name; } }
    if (l.hasBg === undefined) { l.hasBg = false; l.bgColor = 'rgba(255,255,255,0.1)'; l.bgWidth = 20; }
    l.lineMode = l.lineMode || 'single'; l.type = l.type || 'curved';
    l.color1 = l.color1 || l.color || '#00ffcc'; l.width1 = l.width1 || l.width || 2;
    l.animType1 = l.animType1 || 'pixi_dash_fwd'; l.speed1 = l.speed1 || 5;
    l.color2 = l.color2 || '#ff00ff'; l.width2 = l.width2 || 1; l.animType2 = l.animType2 || 'none'; l.speed2 = l.speed2 || 5;
    l.gap = l.gap || 10; if (l.useGlobalAnim === undefined) l.useGlobalAnim = true; if (l.hideLines === undefined) l.hideLines = false;
    nl[l.id] = l;
});
state.links = nl;

let selectedEntity = null, linkingMode = false, linkingSourcePointId = null, dragState = null, needsRender = true, hoveredLinkId = null;
let lineCreationMode = false, currentLineId = null;

// Camera State
let cam = { x: 0, y: 0, scale: 1, isPanningMMB: false, isPanningEdge: false, panStartX: 0, panStartY: 0, isBounded: true, expL: 0, expR: 0, expT: 0, expB: 0 };
const getMapPt = (e) => ({ x: (e.global.x - worldContainer.x) / worldContainer.scale.x, y: (e.global.y - worldContainer.y) / worldContainer.scale.y });
const getScreenPt = (mx, my) => ({ x: mx * worldContainer.scale.x + worldContainer.x, y: my * worldContainer.scale.y + worldContainer.y });

function getSceneBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasObj = false;
    for (let id in state.bubbles) {
        let b = state.bubbles[id]; if (!b) continue;
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + _bW(b)); maxY = Math.max(maxY, b.y + _bH(b));
        hasObj = true;
    }
    for (let id in state.minis) {
        let m = getBC(id); if (!m) continue;
        let hw = (m.rect?.width || 60) / 2, hh = (m.rect?.height || 30) / 2;
        minX = Math.min(minX, m.x - hw); minY = Math.min(minY, m.y - hh);
        maxX = Math.max(maxX, m.x + hw); maxY = Math.max(maxY, m.y + hh);
        hasObj = true;
    }
    for (let id in state.points) {
        let p = state.points[id];
        let px = p._renderedX != null ? p._renderedX : p.x;
        let py = p._renderedY != null ? p._renderedY : p.y;
        if (px != null && py != null) {
            minX = Math.min(minX, px); minY = Math.min(minY, py);
            maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
            hasObj = true;
        }
    }
    // Include open CG iframe panels in scene bounds
    if (typeof window.getCGWorldBounds === 'function') {
        const cgb = window.getCGWorldBounds();
        if (cgb) {
            minX = Math.min(minX, cgb.minX); minY = Math.min(minY, cgb.minY);
            maxX = Math.max(maxX, cgb.maxX); maxY = Math.max(maxY, cgb.maxY);
            hasObj = true;
        }
    }
    if (!hasObj) return null;

    let pw = (maxX - minX) * 0.3, ph = (maxY - minY) * 0.3;
    if (pw === 0) pw = innerWidth * 0.3;
    if (ph === 0) ph = innerHeight * 0.3;

    return {
        minX: minX - pw - cam.expL, maxX: maxX + pw + cam.expR,
        minY: minY - ph - cam.expT, maxY: maxY + ph + cam.expB,
        w: (maxX + pw + cam.expR) - (minX - pw - cam.expL),
        h: (maxY + ph + cam.expB) - (minY - ph - cam.expT)
    };
}

function applyCameraBounds() {
    let bndL = document.getElementById('bound-left'), bndR = document.getElementById('bound-right');
    let bndT = document.getElementById('bound-top'), bndB = document.getElementById('bound-bottom');
    if (!cam.isBounded) {
        if (bndL) bndL.classList.remove('visible'); if (bndR) bndR.classList.remove('visible');
        if (bndT) bndT.classList.remove('visible'); if (bndB) bndB.classList.remove('visible');
        return;
    }

    let b = getSceneBounds();
    if (!b) return;

    let s = worldContainer.scale.x;
    let targetScale = Math.min(innerWidth / b.w, innerHeight / b.h);
    let minScale = Math.min(targetScale, 1.0);

    // Max Zoom out
    if (s < minScale) { s = minScale; worldContainer.scale.set(s); }

    // Panning Limits
    let minWcx = innerWidth - b.maxX * s, maxWcx = -b.minX * s;
    let minWcy = innerHeight - b.maxY * s, maxWcy = -b.minY * s;
    let hitL = false, hitR = false, hitT = false, hitB = false;

    if (minWcx > maxWcx) worldContainer.x = (innerWidth - (b.w * s)) / 2 - b.minX * s;
    else {
        if (worldContainer.x > maxWcx) { worldContainer.x = maxWcx; hitL = true; } // Trying to pan Left (so moving world Right)
        if (worldContainer.x < minWcx) { worldContainer.x = minWcx; hitR = true; } // Trying to pan Right
    }

    if (minWcy > maxWcy) worldContainer.y = (innerHeight - (b.h * s)) / 2 - b.minY * s;
    else {
        if (worldContainer.y > maxWcy) { worldContainer.y = maxWcy; hitT = true; }
        if (worldContainer.y < minWcy) { worldContainer.y = minWcy; hitB = true; }
    }

    if (bndL) bndL.classList.toggle('visible', hitL);
    if (bndR) bndR.classList.toggle('visible', hitR);
    if (bndT) bndT.classList.toggle('visible', hitT);
    if (bndB) bndB.classList.toggle('visible', hitB);
}

// Binds for bounds buttons
setTimeout(() => {
    let bl = document.getElementById('bound-left'), br = document.getElementById('bound-right');
    let bt = document.getElementById('bound-top'), bb = document.getElementById('bound-bottom');
    if (bl) bl.onclick = () => { cam.expL += innerWidth / worldContainer.scale.x * 0.5; applyCameraBounds(); queueRender(); };
    if (br) br.onclick = () => { cam.expR += innerWidth / worldContainer.scale.x * 0.5; applyCameraBounds(); queueRender(); };
    if (bt) bt.onclick = () => { cam.expT += innerHeight / worldContainer.scale.y * 0.5; applyCameraBounds(); queueRender(); };
    if (bb) bb.onclick = () => { cam.expB += innerHeight / worldContainer.scale.y * 0.5; applyCameraBounds(); queueRender(); };

    let btnCam = document.getElementById('btn-camera-mode');
    if (btnCam) btnCam.onclick = e => {
        cam.isBounded = !cam.isBounded;
        e.target.innerText = cam.isBounded ? '🎥 Ограничена' : '🎥 Свободная';
        if (cam.isBounded) { cam.expL = 0; cam.expR = 0; cam.expT = 0; cam.expB = 0; }
        applyCameraBounds(); queueRender();
    };
}, 100);

// Undo/Redo
let stateHistory = [], historyIndex = -1;
const btnUndo = document.getElementById('btn-undo'), btnRedo = document.getElementById('btn-redo'), btnToggleAnim = document.getElementById('btn-toggle-anim');

// --- NEW TOOLBAR UI LOGIC ---

// 0. Toolbar Drag & Collapse
const tbDrag = document.getElementById('tb-drag');
const tbCollapse = document.getElementById('tb-collapse');
const tbContent = document.getElementById('tb-content');
const toolbar = document.getElementById('toolbar');
let isTbDragging = false, tbStartX = 0, tbStartY = 0, tbInitLeft = 0, tbInitTop = 0;

if (tbDrag && toolbar) {
    tbDrag.addEventListener('pointerdown', e => {
        isTbDragging = true; tbStartX = e.clientX; tbStartY = e.clientY;
        let rect = toolbar.getBoundingClientRect();
        if (!toolbar.style.left || toolbar.style.left.includes('%')) {
            toolbar.style.transform = 'none'; toolbar.style.left = rect.left + 'px';
        }
        tbInitLeft = parseInt(toolbar.style.left) || rect.left; tbInitTop = parseInt(toolbar.style.top) || rect.top;
        toolbar.style.transition = 'none';
        e.stopPropagation();
    });
    document.addEventListener('pointermove', e => {
        if (!isTbDragging) return;
        toolbar.style.left = (tbInitLeft + (e.clientX - tbStartX)) + 'px';
        toolbar.style.top = Math.max(0, tbInitTop + (e.clientY - tbStartY)) + 'px';
    });
    document.addEventListener('pointerup', () => { if (isTbDragging) { isTbDragging = false; toolbar.style.transition = 'transform 0.3s'; } });
}
let propsDrag = document.getElementById('prop-title');
let ppPanel = document.getElementById('properties-panel');
let isPpDragging = false, ppStartX = 0, ppStartY = 0, ppInitX = 0, ppInitY = 0;
if (propsDrag && ppPanel) {
    propsDrag.addEventListener('pointerdown', e => {
        isPpDragging = true; ppStartX = e.clientX; ppStartY = e.clientY;
        ppInitX = parseInt(ppPanel.style.left) || 0; ppInitY = parseInt(ppPanel.style.top) || 0;
        e.stopPropagation();
    });
    document.addEventListener('pointermove', e => {
        if (!isPpDragging) return;
        ppPanel.style.left = (ppInitX + (e.clientX - ppStartX)) + 'px';
        ppPanel.style.top = Math.max(0, ppInitY + (e.clientY - ppStartY)) + 'px';
    });
    document.addEventListener('pointerup', () => { isPpDragging = false; });
}
if (tbCollapse && tbContent) {
    tbCollapse.onclick = () => {
        let isCol = tbContent.style.display === 'none';
        tbContent.style.display = isCol ? 'flex' : 'none';
        tbCollapse.innerText = isCol ? '◀' : '▶';
    };
}

// 1. Master Create Dropdown
const btnMasterCreate = document.getElementById('btn-master-create');
const createDropdown = document.getElementById('create-dropdown');
const btnMasterLabel = document.getElementById('btn-master-label');
let currentCreateAction = 'main';

const CREATE_ACTIONS = [
    { val: 'main', text: '🟡 Создать бабл' },
    { val: 'link', text: '🔗 Соединить (Esc)' },
    { val: 'line', text: '➖ Линия' },
    { val: 'ticket', text: '🏷 Тикет (В разраб.)', disabled: true },
    { val: 'text', text: '📝 Текст (В разраб.)', disabled: true },
    { val: 'image', text: '🖼 Картинка (В разраб.)', disabled: true }
];

function updateCreateDropdown() {
    if (!createDropdown) return;
    createDropdown.innerHTML = '';
    CREATE_ACTIONS.forEach(a => {
        if (a.val === currentCreateAction) return;
        let b = document.createElement('button');
        b.setAttribute('data-val', a.val); b.innerText = a.text;
        if (a.disabled) b.style.opacity = '0.5';
        createDropdown.appendChild(b);
    });
}
updateCreateDropdown();

if (btnMasterCreate) {
    btnMasterCreate.onclick = (e) => {
        if (e.target.closest('.dropdown-menu')) return;
        if (currentCreateAction === 'main') { createBAP(null); }
        else if (currentCreateAction === 'line') { startLineCreationMode(); }
        else if (currentCreateAction === 'link') {
            linkingMode = !linkingMode; linkingSourcePointId = null;
            if (linkingMode) btnMasterCreate.classList.add('active'); else btnMasterCreate.classList.remove('active');
            let t = document.getElementById('link-tools'); if (t) t.style.display = linkingMode ? 'flex' : 'none';
            window._cgSetLinking && window._cgSetLinking(linkingMode);
        }
    };
    const ddToggle = document.getElementById('btn-master-dd');
    if (ddToggle) ddToggle.onclick = (e) => { e.stopPropagation(); createDropdown.style.display = createDropdown.style.display === 'flex' ? 'none' : 'flex'; gpDropdown.style.display = 'none'; };
}

if (createDropdown) {
    createDropdown.onclick = (e) => {
        if (e.target.tagName !== 'BUTTON') return;
        e.stopPropagation();
        let val = e.target.getAttribute('data-val'); if (!val) return;
        let act = CREATE_ACTIONS.find(x => x.val === val);
        if (act && act.disabled) { createDropdown.style.display = 'none'; return; }

        currentCreateAction = val;
        btnMasterLabel.innerText = act.text;
        updateCreateDropdown();
        createDropdown.style.display = 'none';
        btnMasterCreate.click();
    };
}

// 2. Global Pattern Dropdown
const btnGlobalPattern = document.getElementById('btn-global-pattern');
const gpDropdown = document.getElementById('gp-dropdown');
const gpLabel = document.getElementById('gp-label');
const emojiGrid = document.getElementById('gp-emoji-picker');
const emojiInput = document.getElementById('gp-emoji-input');

// All standard PIXI HTML emojis 
const EMOJIS = ['😀', '', '😄', '😁', '😆', '😅', '😂', '', '🥲', '☺️', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '', '🤩', '🥳', '', '', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '', '😠', '😡', '🤬', '🤯', '', '🥵', '🥶', '', '', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '👋', '🤚', '🖐', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦵', '🦿', '🦶', '👣', '👂', '🦻', '👃', '🫀', '🫁', '🧠', '🦷', '🦴', '👀', '👁', '👅', '👄', '💋', '🩸', '🐵', '🐒', '🦍', '🦧', '🐶', '🐕', '🦮', '🐩', '🐺', '🦊', '🦝', '🐱', '🐈', '🦁', '🐯', '🐅', '🐆', '🐴', '🐎', '🦄', '🦓', '🦌', '🦬', '🐮', '🐂', '🐃', '🐄', '🐷', '🐖', '🐗', '🐽', '🐏', '🐑', '🐐', '🐪', '🐫', '🦙', '🦒', '🐘', '🦣', '🦏', '🦛', '🐭', '🐁', '🐀', '🐹', '🐰', '🐇', '🐿', '🦫', '🦔', '🦇', '熊', '🐨', '🐼', '🦥', '🦦', '🦨', '🦘', '🦡', '🐾', '🦃', '🐔', '🐓', '🐣', '🐤', '🐥', '🐦', '🐧', '🕊', '🦅', '🦆', '🦢', '🦉', '🦤', '🪶', '🦩', '🦚', '🦜', '🐸', '🐊', '🐢', '🦎', '🐍', '🐲', '🐉', '🦕', '🦖', '🐳', '🐋', '🐬', '🦭', '🐟', '🐠', '🐡', '🦈', '🐙', '🐚', '🐌', '🦋', '🐛', '', '', '🪲', '', '🦗', '🪳', '', '', '🦂', '🦟', '🪰', '🪱', '🦠', '💐', '', '', '🏵', '🌹', '🥀', '🌺', '🌻', '🌼', '🌷', '🌱', '🪴', '🌲', '🌳', '🌴', '🌵', '🌾', '🌿', '☘️', '🍀', '🍁', '🍂', '🍃', '🍇', '🍈', '🍉', '🍊', '🍋', '🍌', '🍍', '🥭', '🍎', '🍏', '🍐', '🍑', '🍒', '🍓', '🫐', '🥝', '🍅', '🫒', '🥥', '🥑', '🍆', '🥔', '🥕', '🌽', '🌶', '🫑', '🥒', '🥬', '🥦', '🧄', '🧅', '🍄', '🥜', '', '🍞', '🥐', '🥖', '🫓', '🥨', '🥯', '🥞', '🧇', '🧀', '🍖', '🍗', '🥩', '🥓', '🍔', '', '🍕', '🌭', '🥪', '🌮', '🌯', '🫔', '🥙', '🧆', '🥚', '🍳', '🥘', '🍲', '🫕', '🥣', '🥗', '🍿', '🧈', '🧂', '🥫', '🍱', '🍘', '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🦀', '🦞', '🦐', '🦑', '🦪', '🍦', '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🥧', '🍫', '', '🍭', '🍮', '🍯', '🍼', '🥛', '☕', '🫖', '', '', '', '🍷', '🍸', '🍹', '', '🍻', '🥂', '🥃', '🥤', '🧋', '🧃', '🧉', '', '', '🍽', '🍴', '', '', '🏺'];

if (btnGlobalPattern) btnGlobalPattern.onclick = (e) => {
    if (e.target.closest('.dropdown-menu') || e.target.tagName === 'INPUT') return;
    gpDropdown.style.display = gpDropdown.style.display === 'flex' ? 'none' : 'flex';
    createDropdown.style.display = 'none';
    if (emojiGrid && emojiGrid.children.length === 0) {
        EMOJIS.forEach(em => {
            let d = document.createElement('div'); d.innerText = em;
            d.onclick = () => { emojiInput.value += em; updateGP({ emojis: emojiInput.value }); };
            emojiGrid.appendChild(d);
        });
    }
};

document.getElementById('gp-emoji-picker-btn')?.addEventListener('click', () => {
    emojiGrid.style.display = emojiGrid.style.display === 'grid' ? 'none' : 'grid';
});

// Hide dropdowns clicking outside
document.addEventListener('click', e => {
    if (e.target.closest('#gp-emoji-picker') || e.target.id === 'gp-emoji-input' || e.target.id === 'gp-emoji-picker-btn') return;
    if (!e.target.closest('#btn-master-create') && !e.target.closest('#create-dropdown')) { if (createDropdown) createDropdown.style.display = 'none'; }
    if (!e.target.closest('#btn-global-pattern') && !e.target.closest('#gp-dropdown')) { if (gpDropdown) gpDropdown.style.display = 'none'; }
});

// UI Sync Function for Global Pattern
function syncGPUI() {
    let m = state.globalAnimConfig.mode;
    document.querySelectorAll('.gp-mode-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-mode') === m));
    document.querySelectorAll('.gp-shape-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-shape') === state.globalAnimConfig.shape));
    if (emojiInput) emojiInput.value = state.globalAnimConfig.emojis;
    let sZ = document.getElementById('gp-size'); if (sZ) sZ.value = state.globalAnimConfig.size;
    let sC = document.getElementById('gp-count'); if (sC) sC.value = state.globalAnimConfig.count || 1;
    let sS = document.getElementById('gp-speed'); if (sS) sS.value = state.globalAnimConfig.speed !== undefined ? state.globalAnimConfig.speed : 50;
    let ssm = document.getElementById('gp-speed-mode'); if (ssm) ssm.value = state.globalAnimConfig.speedMode || 'abs';
    let sG = document.getElementById('gp-has-glow'); if (sG) sG.checked = state.globalAnimConfig.hasGlow !== false;
    let sL = document.getElementById('gp-show-lines'); if (sL) sL.checked = !state.globalAnimConfig.hideLines;

    if (m === 'off') gpLabel.innerText = 'Выкл';
    else if (m === 'pixi_dash') gpLabel.innerText = 'Пунктир';
    else if (m === 'pixi_dots') gpLabel.innerText = 'Точки';
    else if (m === 'pixi_shapes') gpLabel.innerText = 'Фигуры';
    else if (m === 'pixi_energy') gpLabel.innerText = 'Энергия';
    else if (m === 'pixi_symbols') gpLabel.innerText = 'Эмодзи';
}
function updateGP(changes) {
    Object.assign(state.globalAnimConfig, changes);
    Object.values(state.links).forEach(l => {
        if (l && l.useGlobalAnim !== false) {
            if (changes.mode !== undefined) {
                l.animType1 = changes.mode === 'off' ? 'none' : changes.mode;
                l.animType2 = changes.mode === 'off' ? 'none' : changes.mode;
            }
            if (changes.hasGlow !== undefined) l.hasGlow = changes.hasGlow;
        }
    });
    syncGPUI(); queueRender(); saveState();
}

document.querySelectorAll('.gp-mode-btn').forEach(b => b.onclick = () => {
    let mode = b.getAttribute('data-mode'); updateGP({ mode });
});
document.querySelectorAll('.gp-shape-btn').forEach(b => b.onclick = () => {
    updateGP({ mode: 'pixi_shapes', shape: b.getAttribute('data-shape') });
});
emojiInput?.addEventListener('change', e => updateGP({ mode: 'pixi_symbols', emojis: e.target.value }));
document.getElementById('gp-size')?.addEventListener('input', e => updateGP({ size: parseFloat(e.target.value) }));
document.getElementById('gp-count')?.addEventListener('input', e => updateGP({ count: parseFloat(e.target.value) }));
document.getElementById('gp-speed')?.addEventListener('input', e => updateGP({ speed: parseFloat(e.target.value) }));
document.getElementById('gp-speed-mode')?.addEventListener('change', e => updateGP({ speedMode: e.target.value }));
document.getElementById('gp-has-glow')?.addEventListener('change', e => { updateGP({ hasGlow: e.target.checked }); });
document.getElementById('gp-show-lines')?.addEventListener('change', e => { updateGP({ hideLines: !e.target.checked }); });

syncGPUI(); // Initial sync

// 3. Animation Controls
const btnAnimPlay = document.getElementById('btn-anim-play');
const btnAnimPause = document.getElementById('btn-anim-pause');
const btnAnimSolid = document.getElementById('btn-anim-solid');

function updateAnimBtnUI() {
    if (btnAnimPlay) btnAnimPlay.classList.toggle('active', state.animationMode === 'play');
    if (btnAnimPause) btnAnimPause.classList.toggle('active', state.animationMode === 'pause');
    if (btnAnimSolid) btnAnimSolid.classList.toggle('active', state.animationMode === 'solid');
    if (btnToggleAnim) { // Safe fallback for other references if any
        if (state.animationMode === 'play') btnToggleAnim.innerHTML = '✨ Анимация: ИГРАЕТ';
        else if (state.animationMode === 'pause') btnToggleAnim.innerHTML = '⏸ Пауза';
        else btnToggleAnim.innerHTML = '➖ ВЫКЛ';
    }
}
if (btnAnimPlay) btnAnimPlay.onclick = () => { state.animationMode = 'play'; updateAnimBtnUI(); queueRender(); saveState(); };
if (btnAnimPause) btnAnimPause.onclick = () => { state.animationMode = 'pause'; updateAnimBtnUI(); queueRender(); saveState(); };
if (btnAnimSolid) btnAnimSolid.onclick = () => { state.animationMode = 'solid'; updateAnimBtnUI(); queueRender(); saveState(); };

updateAnimBtnUI();

function saveState() { stateHistory = stateHistory.slice(0, historyIndex + 1); stateHistory.push(JSON.parse(JSON.stringify(state))); historyIndex++; updateHB(); if (typeof window.broadcastCanvasUpdate === 'function') window.broadcastCanvasUpdate(); }
function undo() { if (historyIndex > 0) { historyIndex--; state = JSON.parse(JSON.stringify(stateHistory[historyIndex])); selectEntity(null, null); updateAnimBtnUI(); fullRebuild(); updateHB(); } }
function redo() { if (historyIndex < stateHistory.length - 1) { historyIndex++; state = JSON.parse(JSON.stringify(stateHistory[historyIndex])); selectEntity(null, null); updateAnimBtnUI(); fullRebuild(); updateHB(); } }
function updateHB() { if (btnUndo) btnUndo.disabled = historyIndex <= 0; if (btnRedo) btnRedo.disabled = historyIndex >= stateHistory.length - 1; }
if (btnUndo) btnUndo.onclick = undo; if (btnRedo) btnRedo.onclick = redo;
document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'Z')) { e.preventDefault(); redo(); }
    if (e.key === 'Escape') {
        if (linkingMode) { linkingMode = false; linkingSourcePointId = null; let b = document.getElementById('btn-link'); if (b) b.classList.remove('active'); let t = document.getElementById('link-tools'); if (t) t.style.display = 'none'; window._cgSetLinking && window._cgSetLinking(false); queueRender(); }
        if (lineCreationMode) stopLineCreationMode();
    }
});
if (stateHistory.length === 0) saveState();
const ctxMenu = document.getElementById('ctx-menu');
const pxB = {}, pxM = {}, pxL = {}, pxP = {};
let partSys = {}, shTex = {};
window.clearBubblePartSys = () => { partSys = {}; }; // exposed for workspace_engine.js

// Color utils
function cHex(s) { if (typeof s !== 'string') return 0xffffff; s = s.trim(); if (s[0] === '#') return parseInt(s.slice(1, 7), 16) || 0xffffff; if (s.startsWith('rgb')) { let m = s.match(/[\d.]+/g); if (m && m.length >= 3) return (parseInt(m[0]) << 16) | (parseInt(m[1]) << 8) | parseInt(m[2]); } return 0xffffff; }
function cAlpha(s) { if (typeof s !== 'string') return 1; if (s.startsWith('rgba')) { let m = s.match(/[\d.]+/g); if (m && m.length >= 4) return parseFloat(m[3]); } return 1; }

// Shape textures
function gShTex(sh, col, sz) {
    let r = Math.max(4, Math.round(sz)); let k = `${sh}_${col}_${r}`; if (shTex[k]) return shTex[k]; let g = new PIXI.Graphics(); g.beginFill(cHex(col));
    if (sh === 'dec') g.drawCircle(r, r, r); else if (sh === 'cube') g.drawRect(0, 0, r * 2, r * 2); else if (sh === 'hex') { let p = []; for (let i = 0; i < 6; i++) { let a = (i * Math.PI * 2) / 6 - Math.PI / 2; p.push(r + Math.cos(a) * r, r + Math.sin(a) * r); } g.drawPolygon(p); } else { g.arc(r, r * 1.2, r, 0, Math.PI); g.lineTo(r, r * 1.2 - r * 2.5); g.closePath(); }
    g.endFill(); let t = app.renderer.generateTexture(g, { resolution: 2 }); g.destroy(); shTex[k] = t; return t;
}
function gEnTex(col, sz) { let r = Math.max(4, Math.round(sz)); let k = `e_${col}_${r}`; if (shTex[k]) return shTex[k]; let g = new PIXI.Graphics(); g.beginFill(cHex(col), 0.4); g.drawCircle(r * 1.5, r * 1.5, r * 1.5); g.endFill(); g.beginFill(0xffffff); g.drawCircle(r * 1.5, r * 1.5, r * 0.7); g.endFill(); let t = app.renderer.generateTexture(g, { resolution: 2 }); g.destroy(); shTex[k] = t; return t; }
function gSymTex(sym, r, col) { let rSz = Math.max(4, Math.round(r)); let k = `s_${sym}_${rSz}_${col}`; if (shTex[k]) return shTex[k]; let tOpt = new PIXI.Text(sym, { fontFamily: 'Segoe UI Emoji, Arial', fontSize: Math.max(12, rSz * 3 + 8), fill: cHex(col) }); let t = app.renderer.generateTexture(tOpt, { resolution: 2 }); tOpt.destroy(true); shTex[k] = t; return t; }

// Math
function resolveCollisions(mid, vis = new Set()) { let mv = state.bubbles[mid]; if (!mv || vis.has(mid)) return; vis.add(mid); let mcx = mv.x + mv.size / 2, mcy = mv.y + mv.size / 2, mr = mv.size / 2; for (let id in state.bubbles) { if (id === mid) continue; let t = state.bubbles[id]; if (!t) continue; let tcx = t.x + t.size / 2, tcy = t.y + t.size / 2, tr = t.size / 2, dx = tcx - mcx, dy = tcy - mcy, d = Math.hypot(dx, dy), minD = mr + tr + 20; if (d < minD) { if (d === 0) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); } let a = Math.atan2(dy, dx), p = minD - d; t.x += Math.cos(a) * p; t.y += Math.sin(a) * p; t.x = Math.max(0, Math.min(innerWidth - t.size, t.x)); t.y = Math.max(0, Math.min(innerHeight - t.size, t.y)); resolveCollisions(id, vis); } } }

const _bW = b => b.width  || b.size;
const _bH = b => b.height || b.size;
function getBC(id) { if (state.bubbles[id]) { let b = state.bubbles[id]; let bw=_bW(b),bh=_bH(b); return { x: b.x + bw / 2, y: b.y + bh / 2, rect: { width: bw, height: bh } }; } if (state.minis[id]) { let m = state.minis[id], bx = 0, by = 0; if (m.parentId && state.bubbles[m.parentId]) { bx = state.bubbles[m.parentId].x; by = state.bubbles[m.parentId].y; } if (m.cgMini) { let mw=m.w||100, mh=m.h||100; return { x: bx + m.x + mw/2, y: by + m.y + mh/2, rect: { width: mw, height: mh } }; } return { x: bx + m.x, y: by + m.y, rect: { width: m.width || 60, height: m.height || 30 } }; } return null; }

function getEI(bid, c, tx, ty) { if (!c || !c.rect) return { x: 0, y: 0 }; let dx = tx - c.x, dy = ty - c.y; let isC = state.bubbles[bid] && state.bubbles[bid].shape === 'circle'; if (isC) { let r = c.rect.width / 2, d = Math.hypot(dx, dy); return d === 0 ? { x: c.x, y: c.y } : { x: c.x + (dx / d) * r, y: c.y + (dy / d) * r }; } let w2 = c.rect.width / 2, h2 = c.rect.height / 2, sx = dx ? Math.abs(w2 / dx) : Infinity, sy = dy ? Math.abs(h2 / dy) : Infinity, s = Math.min(sx, sy); return s > 1 ? { x: c.x, y: c.y } : { x: c.x + dx * s, y: c.y + dy * s }; }

function getPC(pId, adj) { let p = state.points[pId]; if (!p) return { x: 0, y: 0 }; if (p.attachedTo) { let c = getBC(p.attachedTo); if (!c) return { x: p.x || 0, y: p.y || 0 }; if (p.angle != null) { let tx = c.x + Math.cos(p.angle) * 1000, ty = c.y + Math.sin(p.angle) * 1000; return getEI(p.attachedTo, c, tx, ty); } if (adj) return getEI(p.attachedTo, c, adj.x, adj.y); return { x: c.x, y: c.y }; } return { x: p.x || 0, y: p.y || 0 }; }

function getRaw(pId) { let p = state.points[pId]; if (!p) return { x: 0, y: 0 }; if (p.attachedTo) { let c = getBC(p.attachedTo); return c || { x: 0, y: 0 }; } return { x: p.x || 0, y: p.y || 0 }; }

function getAllPts(link) {
    if (!link) return [];
    let raw = [link.from, ...(link.waypoints || []), link.to].map(getRaw);
    let pts = [];
    pts.push(getPC(link.from, raw.length > 1 ? raw[1] : null));
    if (link.waypoints) link.waypoints.forEach(w => pts.push(getPC(w)));
    pts.push(getPC(link.to, raw.length > 1 ? raw[raw.length - 2] : null));

    if (link.type === 'bent') {
        let bPts = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
            let p1 = pts[i - 1], p2 = pts[i];
            let isHoriz = Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y);
            let off = (link.bOffsets && link.bOffsets[i - 1]) || 0;
            if (isHoriz) {
                let midX = (p1.x + p2.x) / 2 + off;
                // Add two corners
                bPts.push({ x: midX, y: p1.y });
                bPts.push({ x: midX, y: p2.y });
            } else {
                let midY = (p1.y + p2.y) / 2 + off;
                bPts.push({ x: p1.x, y: midY });
                bPts.push({ x: p2.x, y: midY });
            }
            bPts.push(p2);
        }
        return bPts;
    }
    return pts;
}

function getCSI(pt, ap) { if (!ap || ap.length < 2) return 0; let b = 0, mD = Infinity; for (let i = 0; i < ap.length - 1; i++) { let p1 = ap[i], p2 = ap[i + 1]; if (!p1 || !p2) continue; let l2 = (p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2, t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - p1.x) * (p2.x - p1.x) + (pt.y - p1.y) * (p2.y - p1.y)) / l2)), px = p1.x + t * (p2.x - p1.x), py = p1.y + t * (p2.y - p1.y), d = (pt.x - px) ** 2 + (pt.y - py) ** 2; if (d < mD) { mD = d; b = i; } } return b; }

function getOff(pts, off) { if (off === 0 || !pts || pts.length < 2) return pts || []; let r = []; for (let i = 0; i < pts.length; i++) { let prev = i === 0 ? pts[0] : pts[i - 1], next = i === pts.length - 1 ? pts[i] : pts[i + 1]; let dx = next.x - prev.x, dy = next.y - prev.y, len = Math.hypot(dx, dy) || 1; r.push({ x: pts[i].x + (-dy / len) * off, y: pts[i].y + (dx / len) * off }); } return r; }

function getPtOnPoly(pts, off) { if (!pts || pts.length === 0) return { x: 0, y: 0 }; if (pts.length === 1) return pts[0]; let lens = [], tot = 0; for (let i = 0; i < pts.length - 1; i++) { let d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); lens.push(d); tot += d; } if (tot === 0) return pts[0]; let tgt = tot * off, cur = 0; for (let i = 0; i < pts.length - 1; i++) { if (cur + lens[i] >= tgt) { let t = (tgt - cur) / lens[i]; return { x: pts[i].x + t * (pts[i + 1].x - pts[i].x), y: pts[i].y + t * (pts[i + 1].y - pts[i].y) }; } cur += lens[i]; } return pts[pts.length - 1]; }

function getPU(pId) { let c = 0; Object.values(state.links).forEach(l => { if (!l) return; if (l.from === pId) c++; if (l.to === pId) c++; if (l.waypoints && l.waypoints.includes(pId)) c++; }); return c; }

// LUT
function buildLUT(pts, type) {
    if (!pts || pts.length < 2) return []; let s = []; const step = 6;
    if (type === 'sharp' || type === 'ortho' || type === 'bent' || pts.length <= 2) { for (let i = 0; i < pts.length - 1; i++) { let p1 = pts[i], p2 = pts[i + 1], d = Math.hypot(p2.x - p1.x, p2.y - p1.y), st = Math.max(1, Math.ceil(d / step)); for (let j = 0; j <= st; j++) { let t = j / st; s.push({ x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t }); } } }
    else {
        s.push({ x: pts[0].x, y: pts[0].y }); for (let i = 1; i < pts.length - 2; i++) { let p0 = i === 1 ? pts[0] : { x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2 }, cp = pts[i], p2 = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }; let d = Math.hypot(p2.x - p0.x, p2.y - p0.y) + Math.hypot(cp.x - p0.x, cp.y - p0.y), st = Math.max(4, Math.ceil(d / step)); for (let j = 1; j <= st; j++) { let t = j / st; s.push({ x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * cp.x + t * t * p2.x, y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * cp.y + t * t * p2.y }); } }
        let n = pts.length;
        if (n === 3) {
            let p0 = pts[0], cp = pts[1], pe = pts[2], d = Math.hypot(pe.x - p0.x, pe.y - p0.y) + Math.hypot(cp.x - p0.x, cp.y - p0.y), st = Math.max(4, Math.ceil(d / step));
            for (let j = 1; j <= st; j++) { let t = j / st; s.push({ x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * cp.x + t * t * pe.x, y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * cp.y + t * t * pe.y }); }
        } else if (n > 3) {
            let p0 = { x: (pts[n - 3].x + pts[n - 2].x) / 2, y: (pts[n - 3].y + pts[n - 2].y) / 2 }, cp = pts[n - 2], pe = pts[n - 1], d = Math.hypot(pe.x - p0.x, pe.y - p0.y), st = Math.max(4, Math.ceil(d / step));
            for (let j = 1; j <= st; j++) { let t = j / st; s.push({ x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * cp.x + t * t * pe.x, y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * cp.y + t * t * pe.y }); }
        }
    }
    s._len = 0; s._dists = [0];
    for (let i = 1; i < s.length; i++) { let d = Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y); s._len += d; s._dists.push(s._len); }
    return s;
}

function lutLen(l) { return l ? (l._len || 0) : 0; }
function getLPt(l, t) {
    if (!l || l.length < 2) return { x: 0, y: 0 };
    if (l._len === undefined) return l[0]; // fallback safety
    let target = t * l._len;
    if (target <= 0) return { x: l[0].x, y: l[0].y };
    if (target >= l._len) return { x: l[l.length - 1].x, y: l[l.length - 1].y };

    // Binary search for speed over 100-300 point ranges is overkill, linear is fine for < 500 length arrays.
    for (let i = 0; i < l.length - 1; i++) {
        if (target <= l._dists[i + 1]) {
            let segD = l._dists[i + 1] - l._dists[i];
            let w = segD === 0 ? 0 : (target - l._dists[i]) / segD;
            return { x: l[i].x + (l[i + 1].x - l[i].x) * w, y: l[i].y + (l[i + 1].y - l[i].y) * w };
        }
    }
    return { x: l[l.length - 1].x, y: l[l.length - 1].y };
}

// Draw helpers
function drawPath(g, pts, type, col, w, a) { if (!pts || pts.length < 2) return; g.lineStyle({ width: w, color: col, alpha: a, join: PIXI.LINE_JOIN.ROUND, cap: PIXI.LINE_CAP.ROUND }); g.moveTo(pts[0].x, pts[0].y); if (type === 'sharp' || type === 'ortho' || type === 'bent' || pts.length <= 2) { for (let i = 1; i < pts.length; i++)g.lineTo(pts[i].x, pts[i].y); } else { for (let i = 1; i < pts.length - 2; i++) { let xc = (pts[i].x + pts[i + 1].x) / 2, yc = (pts[i].y + pts[i + 1].y) / 2; g.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc); } if (pts.length > 2) { let n = pts.length; g.quadraticCurveTo(pts[n - 2].x, pts[n - 2].y, pts[n - 1].x, pts[n - 1].y); } } }

function drawDash(g, lut, col, w, a, dL, gL, off) { if (!lut || lut.length < 2) return; g.lineStyle({ width: w, color: col, alpha: a, join: PIXI.LINE_JOIN.ROUND, cap: PIXI.LINE_CAP.ROUND }); let pos = ((off % (dL + gL)) + (dL + gL)) % (dL + gL), dr = pos < dL, sR = dr ? (dL - pos) : (gL - (pos - dL)), st = false; for (let i = 0; i < lut.length - 1; i++) { let p1 = lut[i], p2 = lut[i + 1], sL = Math.hypot(p2.x - p1.x, p2.y - p1.y); if (sL === 0) continue; let con = 0; while (con < sL) { let tk = Math.min(sL - con, sR), t1 = con / sL, t2 = (con + tk) / sL; let x1 = p1.x + (p2.x - p1.x) * t1, y1 = p1.y + (p2.y - p1.y) * t1, x2 = p1.x + (p2.x - p1.x) * t2, y2 = p1.y + (p2.y - p1.y) * t2; if (dr) { if (!st) { g.moveTo(x1, y1); st = true; } g.lineTo(x2, y2); } con += tk; sR -= tk; if (sR <= 0.01) { dr = !dr; sR = dr ? dL : gL; st = false; } } } }

// Effective config
function getEC(link, li) { let at = li === 1 ? link.animType1 : link.animType2; let isG = link.useGlobalAnim !== false; let mode = isG ? state.globalAnimConfig.mode : at; let isP = mode && (mode === 'pixi_shapes' || mode === 'pixi_energy' || mode === 'pixi_symbols'); return { isP, mode: mode || 'pixi_dash', at: at || 'none', shape: isG ? state.globalAnimConfig.shape : (li === 1 ? link.l1Shape : link.l2Shape) || 'drop', emojis: isG ? state.globalAnimConfig.emojis : (li === 1 ? link.l1Emojis : link.l2Emojis) || '❤️⭐✨', size: isG ? state.globalAnimConfig.size : (li === 1 ? link.l1Size : link.l2Size) || 1, count: isG ? state.globalAnimConfig.count : (li === 1 ? link.l1Count : link.l2Count) || 1, wobble: isG ? state.globalAnimConfig.wobble : 0, hide: link.hideLines || (isG && state.globalAnimConfig.hideLines) }; }

// Context menus
function openIPM(linkId, idx, x, y) {
    if (!ctxMenu) return; ctxMenu.innerHTML = '';
    const ab = (t, fn, d) => { let b = document.createElement('div'); b.className = 'ctx-btn' + (d ? ' danger' : ''); b.innerText = t; b.onclick = ev => { ev.stopPropagation(); ctxMenu.style.display = 'none'; fn(); }; ctxMenu.appendChild(b); };
    const realize = () => { let pId = 'p_' + generateId(); state.points[pId] = { x, y, attachedTo: null, angle: null }; if (state.links[linkId] && state.links[linkId].waypoints) state.links[linkId].waypoints.splice(idx, 0, pId); queueRender(); saveState(); return pId; };
    ab('🔗 Связь отсюда', () => handleLinking(realize()));
    ab('➕ Блок здесь', () => createBAP(realize()));
    ab('📝 Подписать', () => addLTL(linkId));
    ab('⚙️ Свойства линии', () => selectEntity('link', linkId, true));
    ctxMenu.style.left = x + 15 + 'px'; ctxMenu.style.top = y + 15 + 'px'; ctxMenu.style.display = 'flex';
}

function openRPM(pId, e) {
    if (!ctxMenu) return; ctxMenu.innerHTML = ''; let u = getPU(pId); let isWp = false, wLid = null;
    Object.values(state.links).forEach(l => { if (l && l.waypoints && l.waypoints.includes(pId)) { isWp = true; wLid = l.id; } });
    const ab = (t, fn, d) => { let b = document.createElement('div'); b.className = 'ctx-btn' + (d ? ' danger' : ''); b.innerText = t; b.onclick = ev => { ev.stopPropagation(); ctxMenu.style.display = 'none'; fn(); }; ctxMenu.appendChild(b); };
    if (u > 1) ab('✂ Разделить', () => splitPt(pId), true);
    ab('🔗 Связь отсюда', () => handleLinking(pId));
    if (state.points[pId] && !state.points[pId].attachedTo) ab('➕ Блок здесь', () => createBAP(pId));
    if (isWp && wLid) { ab('📝 Подписать', () => addLTL(wLid)); ab('⚙️ Свойства линии', () => selectEntity('link', wLid, true)); ab('❌ Удалить точку', () => delPt(pId), true); }
    ctxMenu.style.left = (e.clientX || e.x || 0) + 15 + 'px'; ctxMenu.style.top = (e.clientY || e.y || 0) + 15 + 'px'; ctxMenu.style.display = 'flex';
}

function splitPt(pId) {
    let pd = state.points[pId]; if (!pd) return; let first = true;
    Object.values(state.links).forEach(l => {
        if (!l) return; const dup = () => { let n = 'p_' + generateId(); state.points[n] = { ...pd }; return n; };
        if (l.from === pId) { if (first) first = false; else l.from = dup(); }
        if (l.to === pId) { if (first) first = false; else l.to = dup(); }
        if (l.waypoints) l.waypoints = l.waypoints.map(w => { if (w === pId) { if (first) { first = false; return w; } return dup(); } return w; });
    });
    queueRender(); saveState();
}

function delPt(pId) { let dl = []; Object.values(state.links).forEach(l => { if (!l) return; if (l.from === pId || l.to === pId) dl.push(l.id); else if (l.waypoints) l.waypoints = l.waypoints.filter(w => w !== pId); }); dl.forEach(id => delete state.links[id]); delete state.points[pId]; queueRender(); saveState(); }

function createBAP(pId) {
    let pt = state.points[pId]; if (!pt) return; let bId = 'main_' + generateId(); let px = pt._renderedX != null ? pt._renderedX : (pt.x || 0), py = pt._renderedY != null ? pt._renderedY : (pt.y || 0);
    state.bubbles[bId] = { id: bId, name: 'Блок', x: px - 100, y: py - 100, size: 200, shape: 'circle', bgColor: 'rgba(255,0,100,0.1)', borderColor: '#ff0066', glowColor: '#ff0066' };
    pt.attachedTo = bId; pt.angle = null; queueRender(); saveState(); selectEntity('main', bId);
}

function addLTL(linkId) { let l = state.links[linkId]; if (!l) return; if (!l.labels) l.labels = []; l.labels.push({ id: 'lbl_' + generateId(), text: 'Связь', type: 'callout', offset: 0.5 }); selectEntity('link', linkId); queueRender(); saveState(); }

// Full rebuild after undo/redo
function fullRebuild() { for (let id in pxB) { if (pxB[id]._edgeTmr) { clearTimeout(pxB[id]._edgeTmr); pxB[id]._edgeTmr = null; } pxB[id].c.destroy({ children: true }); delete pxB[id]; } for (let id in pxM) { pxM[id].c.destroy({ children: true }); delete pxM[id]; } for (let id in pxL) { dLC(id); } for (let id in pxP) { pxP[id].g.destroy(); delete pxP[id]; } for (let id in partSys) { partSys[id].forEach(p => { if (p.sprite) p.sprite.destroy(); }); delete partSys[id]; } needsRender = true; }
function dLC(id) { let c = pxL[id]; if (!c) return; c.bg.destroy(); c.glow.destroy(); c.l1.destroy(); c.l2.destroy(); c.hit.destroy({ children: true }); c.lblC.destroy({ children: true }); c.partC.destroy({ children: true }); delete pxL[id]; }

// Line Creation Mode functions
function startLineCreationMode() {
    lineCreationMode = true;
    currentLineId = null;
    linkingMode = false; // Disable linking mode if line creation starts
    linkingSourcePointId = null;
    if (btnMasterCreate) btnMasterCreate.classList.add('active');
    let t = document.getElementById('link-tools'); if (t) t.style.display = 'none'; // Hide link tools
    window._cgSetLinking && window._cgSetLinking(true);
    queueRender();
    selectEntity(null, null); // Deselect any entity
}

function stopLineCreationMode() {
    lineCreationMode = false;
    currentLineId = null;
    if (btnMasterCreate) btnMasterCreate.classList.remove('active');
    window._cgSetLinking && window._cgSetLinking(false);
    queueRender();
    saveState();
}

function handleLineSeqClick(pId) {
    if (!lineCreationMode) return;

    if (!currentLineId) {
        // Start a new line
        let nId = 'link_' + generateId();
        let ltT = document.getElementById('lt-type'), ltM = document.getElementById('lt-mode'), ltC = document.getElementById('lt-color');
        state.links[nId] = {
            id: nId,
            from: pId,
            to: pId,
            labels: [],
            type: ltT ? ltT.value : defaultLP.type,
            lineMode: ltM ? ltM.value : defaultLP.lineMode,
            gap: 10,
            waypoints: [],
            hasGlow: true,
            glowOpacity: 0.3,
            hasBg: false,
            bgColor: 'rgba(255,255,255,0.1)',
            bgWidth: 20,
            color1: ltC ? ltC.value : defaultLP.color,
            width1: 2,
            animType1: 'pixi_dash_fwd',
            speed1: 5,
            color2: '#ff00ff',
            width2: 2,
            animType2: 'none',
            speed2: 5,
            useGlobalAnim: true,
            hideLines: false
        };
        currentLineId = nId;
        selectEntity('link', nId);
    } else {
        let currentLink = state.links[currentLineId];
        if (!currentLink) {
            stopLineCreationMode();
            return;
        }

        // Prevent duplicate overlapping points
        let pA = state.points[pId];
        let pB = state.points[currentLink.to];
        if (pA && pB) {
            let dist = Math.hypot(pA.x - pB.x, pA.y - pB.y);
            if (pId === currentLink.to || dist < 10) return; // ignore jitter/double clicks
        }

        if (pId === currentLink.from) {
            // User clicked the starting point again, close the loop
            currentLink.to = pId;
            stopLineCreationMode();
        } else if (pId === currentLink.to) {
            // User double clicked or same point hit
            return;
        } else if (currentLink.to === currentLink.from) {
            // This is the second point, set it as 'to'
            currentLink.to = pId;
        } else {
            // Add as a waypoint
            if (!currentLink.waypoints) currentLink.waypoints = [];
            currentLink.waypoints.push(currentLink.to); // Move current 'to' to waypoints
            currentLink.to = pId; // Set new 'to'
        }
    }
    queueRender();
    saveState();
}

// Global pointerdown handler for canvas background
app.stage.on('pointerdown', e => {
    if (e.button === 1 || (e.button === 0 && e.data.originalEvent.code === 'Space')) {
        cam.isPanningMMB = true;
        cam.panStartX = e.global.x;
        cam.panStartY = e.global.y;
        document.body.style.cursor = 'grabbing';
        return;
    }

    if (e.button === 2) { // Right-click
        if (lineCreationMode) {
            stopLineCreationMode();
            e.stopPropagation();
            return;
        }
    }

    let mp = getMapPt(e);
    if (lineCreationMode) {
        e.stopPropagation();
        let pId = 'p_' + generateId();
        state.points[pId] = { x: mp.x, y: mp.y, attachedTo: null, angle: null };
        handleLineSeqClick(pId);
        return;
    }

    if (linkingMode) {
        e.stopPropagation();
        let pId = 'p_' + generateId();
        state.points[pId] = { x: mp.x, y: mp.y, attachedTo: null, angle: null };
        handleLinking(pId);
        return;
    }

    if (dragState) return;
    if (ctxMenu) ctxMenu.style.display = 'none';
    selectEntity(null, null);
    if (!currentUser) return;
    if (e.target === app.stage) {
        if (e.data.button === 0) {
            let cx = e.global.x, cy = e.global.y;
            let mBtn = document.getElementById('tb-drag');
            if (mBtn) {
                let r = mBtn.getBoundingClientRect();
                if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return;
            }
            if (lineCreationMode) {
                let mp = getMapPt(e); let pId = 'p_' + generateId(); state.points[pId] = { x: mp.x, y: mp.y, attachedTo: null, angle: null };
                handleLineSeqClick(pId); return;
            }
            selectEntity(null, null);
            dragState = { type: 'lasso', sX: cx, sY: cy, curX: cx, curY: cy };
            let cm = document.getElementById('ctx-menu'); if (cm) cm.style.display = 'none';
        }
        else if (e.data.button === 1 || e.data.button === 2) {
            cam.isPanningMMB = true;
            cam.panStartX = e.global.x; cam.panStartY = e.global.y;
            document.body.style.cursor = 'grabbing';
        }
    }
});

app.stage.on('pointerup', e => {
    if (!currentUser) return;
    if (cam.isPanningMMB) { cam.isPanningMMB = false; document.body.style.cursor = 'default'; }
    if (dragState && dragState.type === 'lasso') {
        let minX = Math.min(dragState.sX, dragState.curX), maxX = Math.max(dragState.sX, dragState.curX);
        let minY = Math.min(dragState.sY, dragState.curY), maxY = Math.max(dragState.sY, dragState.curY);
        selectedBubbles.clear();
        for (let id in state.bubbles) {
            let b = state.bubbles[id]; if (!b) continue;
            let bw = _bW(b), bh = _bH(b);
            let scr = getScreenPt(b.x + bw / 2, b.y + bh / 2);
            let sw = bw * worldContainer.scale.x, sh = bh * worldContainer.scale.y;
            if (scr.x + sw/2 > minX && scr.x - sw/2 < maxX && scr.y + sh/2 > minY && scr.y - sh/2 < maxY) {
                selectedBubbles.add(id);
            }
        }
        dragState = null; queueRender();
    }
});
app.stage.on('pointerupoutside', e => {
    if (!currentUser) return;
    if (cam.isPanningMMB) {
        cam.isPanningMMB = false;
        document.body.style.cursor = 'default';
    }
    if (dragState && dragState.type === 'lasso') {
        dragState = null;
        selectionBox.clear();
        queueRender();
    }
});
app.stage.on('pointermove', e => {
    if (!currentUser) return;
    if (cam.isPanningMMB) {
        let dx = e.global.x - cam.panStartX;
        let dy = e.global.y - cam.panStartY;
        worldContainer.x += dx; worldContainer.y += dy;
        cam.panStartX = e.global.x; cam.panStartY = e.global.y;
        if (typeof applyCameraBounds === 'function') applyCameraBounds();
        queueRender();
    }
    if (dragState && dragState.type === 'lasso') {
        dragState.curX = e.global.x; dragState.curY = e.global.y; queueRender();
    }
});


// ── Bubble edge-resize helpers ───────────────────────────────────────────────
const _EDGE = 14; // world-px threshold for edge detection
function _bubEdgeCheck(e, bid, c, cache) {
    if (dragState) return;
    let bd = state.bubbles[bid]; if (!bd) return;
    let mp = getMapPt(e);
    let lx = mp.x - bd.x, ly = mp.y - bd.y;
    let bw = _bW(bd), bh = _bH(bd), isC = bd.shape === 'circle';
    let dir = null, cur = 'grab';
    if (isC) {
        let r = bd.size / 2, cx = r, cy = r;
        let dist = Math.hypot(lx - cx, ly - cy);
        if (dist >= r - _EDGE && dist <= r + _EDGE) { dir = 'radial'; cur = 'nwse-resize'; }
    } else {
        let nL = lx >= -_EDGE && lx <= _EDGE, nR = lx >= bw - _EDGE && lx <= bw + _EDGE;
        let nT = ly >= -_EDGE && ly <= _EDGE, nB = ly >= bh - _EDGE && ly <= bh + _EDGE;
        if (nR && nB) { dir='se'; cur='se-resize'; } else if (nL && nT) { dir='nw'; cur='nw-resize'; }
        else if (nR && nT) { dir='ne'; cur='ne-resize'; } else if (nL && nB) { dir='sw'; cur='sw-resize'; }
        else if (nR) { dir='e'; cur='e-resize'; } else if (nL) { dir='w'; cur='w-resize'; }
        else if (nB) { dir='s'; cur='s-resize'; } else if (nT) { dir='n'; cur='n-resize'; }
    }
    if (dir) {
        cache._resCur = cur;
        if (!cache._edgeTmr) {
            cache._edgeTmr = setTimeout(() => {
                cache._edgeTmr = null;
                if (!state.bubbles[bid]) return; // bubble deleted while timer ran
                cache._resDir = dir; c.cursor = cur;
            }, 2000);
        }
    } else {
        _bubEdgeClear(c, cache);
    }
    if (cache._resDir) c.cursor = cache._resCur;
}
function _bubEdgeClear(c, cache) {
    if (cache._edgeTmr) { clearTimeout(cache._edgeTmr); cache._edgeTmr = null; }
    if (cache._resDir) { cache._resDir = null; c.cursor = 'grab'; }
}
function _bubStartResize(e, bd, cache, c) {
    selectEntity('main', bd.id);
    let mp = getMapPt(e);
    let iX = bd.x, iY = bd.y, iW = _bW(bd), iH = _bH(bd), iS = bd.size;
    let dir = cache._resDir;
    c.cursor = 'grabbing';
    const onM = me => {
        let mpC = getMapPt(me), dx = mpC.x - mp.x, dy = mpC.y - mp.y;
        if (bd.shape === 'circle') {
            let cx = iX + iS / 2, cy = iY + iS / 2;
            let newR = Math.max(30, Math.hypot(mpC.x - cx, mpC.y - cy));
            bd.size = newR * 2; bd.x = cx - newR; bd.y = cy - newR;
            bd.width = bd.size; bd.height = bd.size;
        } else {
            if (dir.includes('e')) { bd.width  = Math.max(60, iW + dx); }
            if (dir.includes('w')) { bd.x = iX + dx; bd.width  = Math.max(60, iW - dx); }
            if (dir.includes('s')) { bd.height = Math.max(60, iH + dy); }
            if (dir.includes('n')) { bd.y = iY + dy; bd.height = Math.max(60, iH - dy); }
        }
        queueRender();
    };
    const onU = () => {
        app.stage.off('pointermove', onM); app.stage.off('pointerup', onU); app.stage.off('pointerupoutside', onU);
        c.cursor = cache._resCur; saveState();
    };
    app.stage.on('pointermove', onM); app.stage.on('pointerup', onU); app.stage.on('pointerupoutside', onU);
}

// Render Bubbles
function renderBubbles() {
    let active = new Set(Object.keys(state.bubbles)); for (let id in pxB) { if (!active.has(id)) { pxB[id].c.destroy({ children: true }); delete pxB[id]; } }
    Object.values(state.bubbles).forEach(d => {
        if (!d) return; let cache = pxB[d.id];
        if (!cache) {
            let c = new PIXI.Container(); c.eventMode = 'static'; c.cursor = 'grab'; let bg = new PIXI.Graphics(), brd = new PIXI.Graphics();
            let title = new PIXI.Text('', { fontFamily: 'Segoe UI', fontSize: 16, fontWeight: 'bold', fill: 0xffffff, align: 'center', wordWrap: true }); title.anchor.set(0.5, 0);
            let gear = new PIXI.Text('⚙️', { fontSize: 22 }); gear.anchor.set(0.5); gear.eventMode = 'static'; gear.cursor = 'pointer';
            gear.on('pointerdown', e => { e.stopPropagation(); if (ctxMenu) ctxMenu.style.display = 'none'; selectEntity('main', d.id, true); });
            c.addChild(bg, brd, title, gear); layerBub.addChild(c);
            cache = { c, bg, brd, title, gear, _edgeTmr: null, _resDir: null, _resCur: 'grab' }; pxB[d.id] = cache;
            c.on('pointermove', e => _bubEdgeCheck(e, d.id, c, cache));
            c.on('pointerout', () => _bubEdgeClear(c, cache));
            c.on('pointerdown', e => {
                if (ctxMenu) ctxMenu.style.display = 'none';
                e.stopPropagation();
                if (linkingMode || lineCreationMode) {
                    let pId = 'p_' + generateId(), bd2 = state.bubbles[d.id];
                    let mp2 = getMapPt(e);
                    let cx2 = bd2 ? bd2.x + _bW(bd2)/2 : 0, cy2 = bd2 ? bd2.y + _bH(bd2)/2 : 0;
                    let dist2 = Math.hypot(mp2.x - cx2, mp2.y - cy2);
                    let halfR = Math.max(_bW(bd2)||1, _bH(bd2)||1) * 0.5;
                    let ang2 = dist2 > halfR * 0.3 ? Math.atan2(mp2.y - cy2, mp2.x - cx2) : null;
                    state.points[pId] = { attachedTo: d.id, angle: ang2 };
                    if (linkingMode) handleLinking(pId); else handleLineSeqClick(pId); return;
                }
                if (e.button !== 0) return; // only left-click triggers resize/drag
                let bd = state.bubbles[d.id]; if (!bd) return;
                if (cache._resDir) { _bubStartResize(e, bd, cache, c); return; }
                selectEntity('main', d.id);
                let mpStart = getMapPt(e); let iX = bd.x, iY = bd.y; c.cursor = 'grabbing';

                let isGroup = selectedBubbles.has(d.id);
                let startPos = {};
                if (isGroup) {
                    selectedBubbles.forEach(bid => { if (state.bubbles[bid]) startPos[bid] = { x: state.bubbles[bid].x, y: state.bubbles[bid].y }; });
                }

                const onM = me => {
                    let mpCurr = getMapPt(me);
                    let dx = mpCurr.x - mpStart.x, dy = mpCurr.y - mpStart.y;
                    if (isGroup) {
                        selectedBubbles.forEach(bid => {
                            let b = state.bubbles[bid];
                            if (b && startPos[bid]) { b.x = startPos[bid].x + dx; b.y = startPos[bid].y + dy; resolveCollisions(bid); }
                        });
                    } else {
                        bd.x = iX + dx; bd.y = iY + dy; resolveCollisions(d.id);
                    }
                    queueRender();
                };
                const onU = () => { app.stage.off('pointermove', onM); app.stage.off('pointerup', onU); app.stage.off('pointerupoutside', onU); c.cursor = 'grab'; saveState(); };
                app.stage.on('pointermove', onM); app.stage.on('pointerup', onU); app.stage.on('pointerupoutside', onU);
            });
            c.on('rightclick', e => {
                e.stopPropagation();
                if (lineCreationMode) { stopLineCreationMode(); return; }
                if (!ctxMenu) return; ctxMenu.innerHTML = '';
                let bm = document.createElement('div'); bm.className = 'ctx-btn'; bm.innerText = '🟢 Создать Мини Бабл';
                bm.onclick = ev => {
                    ev.stopPropagation(); ctxMenu.style.display = 'none';
                    let mid = 'mini_' + generateId();
                    state.minis[mid] = { id: mid, name: 'Мини', parentId: d.id, x: _bW(d) / 2, y: _bH(d) / 2, bgColor: 'rgba(0,255,200,0.2)', borderColor: '#00ffcc', glowColor: '#00ffcc' };
                    queueRender(); selectEntity('mini', mid); saveState();
                };
                ctxMenu.appendChild(bm);

                let bp = document.createElement('div'); bp.className = 'ctx-btn'; bp.innerText = '⚙️ Свойства бабла';
                bp.onclick = ev => { ev.stopPropagation(); ctxMenu.style.display = 'none'; selectEntity('main', d.id, true); };
                ctxMenu.appendChild(bp);

                let bdel = document.createElement('div'); bdel.className = 'ctx-btn danger'; bdel.innerText = '❌ Удалить бабл';
                bdel.onclick = ev => {
                    ev.stopPropagation(); ctxMenu.style.display = 'none';
                    delete state.bubbles[d.id];
                    for (let m in state.minis) if (state.minis[m]?.parentId === d.id) delete state.minis[m];
                    for (let p in state.points) if (state.points[p]?.attachedTo === d.id) { state.points[p].attachedTo = null; state.points[p].x = state.points[p]._renderedX||0; state.points[p].y = state.points[p]._renderedY||0; }
                    selectEntity(null, null); queueRender(); saveState();
                };
                ctxMenu.appendChild(bdel);

                // CG integration hook
                if (typeof window._cgContextMenuHook === 'function') window._cgContextMenuHook(d.id, ctxMenu);

                ctxMenu.style.left = e.global.x + 15 + 'px'; ctxMenu.style.top = e.global.y + 15 + 'px'; ctxMenu.style.display = 'flex';
            });
        }
        let bw = _bW(d), bh = _bH(d), isC = d.shape === 'circle';
        let s = isC ? d.size : Math.max(bw, bh); // keep s for circle radius math
        cache.bg.clear(); cache.bg.beginFill(cHex(d.bgColor), cAlpha(d.bgColor));
        if (isC) cache.bg.drawCircle(s/2, s/2, s/2); else cache.bg.drawRoundedRect(0, 0, bw, bh, 20); cache.bg.endFill();
        // Glow
        cache.bg.beginFill(cHex(d.glowColor), 0.08);
        if (isC) cache.bg.drawCircle(s/2, s/2, s/2+15); else cache.bg.drawRoundedRect(-15,-15,bw+30,bh+30,35);
        cache.bg.endFill();
        cache.brd.clear(); cache.brd.lineStyle(2, cHex(d.borderColor), 1);
        if (isC) cache.brd.drawCircle(s/2, s/2, s/2); else cache.brd.drawRoundedRect(0, 0, bw, bh, 20);

        let isSel = (selectedEntity && selectedEntity.id === d.id && selectedEntity.type === 'main') || selectedBubbles.has(d.id);
        if (isSel) {
            cache.brd.lineStyle(2, 0xffffff, selectedBubbles.has(d.id) ? 1.0 : 0.7);
            if (isC) cache.brd.drawCircle(s/2, s/2, s/2+5);
            else cache.brd.drawRoundedRect(-5, -5, bw+10, bh+10, 24);
        }
        cache.title.text = d.name || ''; cache.title.style.wordWrapWidth = (isC?s:bw) - 40; cache.title.position.set((isC?s:bw)/2, 20);
        let gx = isC ? s/2 + (s/2)*0.707 - 18 : bw - 25;
        let gy = isC ? s/2 - (s/2)*0.707 + 18 : 25;
        cache.gear.position.set(gx, gy);
        cache.c.position.set(d.x, d.y);
    });
}

// Render Minis
function renderMinis() {
    let active = new Set(Object.keys(state.minis)); for (let id in pxM) { if (!active.has(id)) { pxM[id].c.destroy({ children: true }); delete pxM[id]; } }
    Object.values(state.minis).forEach(d => {
        if (!d) return; let cache = pxM[d.id];
        if (!cache) {
            let c = new PIXI.Container(); c.eventMode = 'static'; c.cursor = 'grab'; let bg = new PIXI.Graphics();
            let txt = new PIXI.Text('', { fontFamily: 'Segoe UI', fontSize: 12, fontWeight: '500', fill: 0xffffff, align: 'center' }); txt.anchor.set(0.5, 0.5);
            let gear = new PIXI.Text('⚙️', { fontSize: 14 }); gear.anchor.set(0.5); gear.eventMode = 'static'; gear.cursor = 'pointer';
            gear.on('pointerdown', e => { e.stopPropagation(); if (ctxMenu) ctxMenu.style.display = 'none'; selectEntity('mini', d.id, true); });
            c.addChild(bg, txt, gear); layerBub.addChild(c); cache = { c, bg, txt, gear }; pxM[d.id] = cache;
            c.on('pointerdown', e => {
                e.stopPropagation(); if (ctxMenu) ctxMenu.style.display = 'none';
                if (linkingMode || lineCreationMode) {
                    let pId = 'p_' + generateId();
                    let mp2 = getMapPt(e), bc2 = getBC(d.id);
                    let ang2 = bc2 ? Math.atan2(mp2.y - bc2.y, mp2.x - bc2.x) : null;
                    state.points[pId] = { attachedTo: d.id, angle: ang2 };
                    if (linkingMode) handleLinking(pId); else handleLineSeqClick(pId); return;
                }
                selectEntity('mini', d.id);
                // CG world is opened via right-click context menu (createCGWindows)
                let pos = getBC(d.id); if (!pos) return; let mpStart = getMapPt(e); let offX = mpStart.x - pos.x, offY = mpStart.y - pos.y; c.cursor = 'grabbing';
                const onM = me => { let mpCurr = getMapPt(me); let gX = mpCurr.x - offX, gY = mpCurr.y - offY; if (d.parentId && state.bubbles[d.parentId]) { d.x = gX - state.bubbles[d.parentId].x; d.y = gY - state.bubbles[d.parentId].y; } else { d.x = gX; d.y = gY; } queueRender(); };
                const onU = me => {
                    app.stage.off('pointermove', onM); app.stage.off('pointerup', onU); app.stage.off('pointerupoutside', onU); c.cursor = 'grab';
                    let mpCurr = getMapPt(me); let gX = mpCurr.x - offX, gY = mpCurr.y - offY, fp = null; for (let bid in state.bubbles) { let b = state.bubbles[bid]; if (b && gX >= b.x && gX <= b.x + b.size && gY >= b.y && gY <= b.y + b.size) { fp = bid; break; } }
                    if (fp) { d.parentId = fp; d.x = gX - state.bubbles[fp].x; d.y = gY - state.bubbles[fp].y; } else { d.parentId = null; d.x = gX; d.y = gY; } queueRender(); saveState();
                };
                app.stage.on('pointermove', onM); app.stage.on('pointerup', onU); app.stage.on('pointerupoutside', onU);
            });
            c.on('rightclick', e => {
                e.stopPropagation();
                if (lineCreationMode) { stopLineCreationMode(); return; }
                if (!ctxMenu) return; ctxMenu.innerHTML = '';

                let bp = document.createElement('div'); bp.className = 'ctx-btn'; bp.innerText = '⚙️ Свойства мини-бабла';
                bp.onclick = ev => { ev.stopPropagation(); ctxMenu.style.display = 'none'; selectEntity('mini', d.id, true); };
                ctxMenu.appendChild(bp);

                let bdel = document.createElement('div'); bdel.className = 'ctx-btn danger'; bdel.innerText = '❌ Удалить мини-бабл';
                bdel.onclick = ev => {
                    ev.stopPropagation(); ctxMenu.style.display = 'none';
                    delete state.minis[d.id];
                    for (let p in state.points) if (state.points[p]?.attachedTo === d.id) { state.points[p].attachedTo = null; state.points[p].x = state.points[p]._renderedX||0; state.points[p].y = state.points[p]._renderedY||0; }
                    selectEntity(null, null); queueRender(); saveState();
                };
                ctxMenu.appendChild(bdel);

                ctxMenu.style.left = e.global.x + 15 + 'px'; ctxMenu.style.top = e.global.y + 15 + 'px'; ctxMenu.style.display = 'flex';
            });
        }
        let px = d.x, py = d.y;
        if (d.parentId && state.bubbles[d.parentId]) { px += state.bubbles[d.parentId].x; py += state.bubbles[d.parentId].y; }
        if (d.cgMini && d.w && d.h) {
            // ── Large CG mini: origin = top-left, draws a rect frame ──────────
            const dw = d.w, dh = d.h, rad = d.borderRadius || 12;
            cache.txt.text = '';
            cache.bg.clear();
            cache.bg.beginFill(cHex(d.glowColor || d.bgColor), 0.04);
            cache.bg.drawRoundedRect(-8, -8, dw + 16, dh + 16, rad + 8); cache.bg.endFill();
            cache.bg.beginFill(cHex(d.bgColor), 0.06);
            cache.bg.drawRoundedRect(0, 0, dw, dh, rad); cache.bg.endFill();
            cache.bg.lineStyle(2, cHex(d.borderColor), 0.7);
            cache.bg.drawRoundedRect(0, 0, dw, dh, rad);
            if (selectedEntity?.id === d.id && selectedEntity.type === 'mini') {
                cache.bg.lineStyle(2, 0xffffff, 0.55);
                cache.bg.drawRoundedRect(-4, -4, dw + 8, dh + 8, rad + 4);
            }
            cache.gear.position.set(dw - 16, 20);
        } else if (d.shape === 'rect' || d.shape === 'oval') {
            // ── Explicit-sized rect / oval mini ──────────────────────────────
            cache.txt.text = d.name || '';
            const tw = d.w || (cache.txt.width + 48), th = d.h || (cache.txt.height + 32);
            const rad = d.shape === 'oval' ? Math.min(tw, th) / 2 : (d.borderRadius != null ? d.borderRadius : 20);
            cache.bg.clear();
            cache.bg.beginFill(cHex(d.glowColor), 0.08); cache.bg.drawRoundedRect(-tw/2-6, -th/2-6, tw+12, th+12, rad+6); cache.bg.endFill();
            cache.bg.beginFill(cHex(d.bgColor), cAlpha(d.bgColor));
            if (d.shape === 'oval') cache.bg.drawEllipse(0, 0, tw/2, th/2);
            else cache.bg.drawRoundedRect(-tw/2, -th/2, tw, th, rad);
            cache.bg.endFill();
            cache.bg.lineStyle(1.5, cHex(d.borderColor), 1);
            if (d.shape === 'oval') cache.bg.drawEllipse(0, 0, tw/2, th/2);
            else cache.bg.drawRoundedRect(-tw/2, -th/2, tw, th, rad);
            if (selectedEntity?.id === d.id && selectedEntity.type === 'mini') {
                cache.bg.lineStyle(2, 0xffffff, 0.7);
                if (d.shape === 'oval') cache.bg.drawEllipse(0, 0, tw/2+4, th/2+4);
                else cache.bg.drawRoundedRect(-tw/2-4, -th/2-4, tw+8, th+8, rad+4);
            }
            cache.txt.position.set(0, 0);
            cache.gear.position.set(tw/2 - 4, -th/2 + 4);
        } else {
            // ── Standard text-pill mini ───────────────────────────────────────
            cache.txt.text = d.name || ''; let tw = cache.txt.width + 24, th = cache.txt.height + 16;
            cache.bg.clear(); cache.bg.beginFill(cHex(d.bgColor), cAlpha(d.bgColor)); cache.bg.drawRoundedRect(-tw / 2, -th / 2, tw, th, 20); cache.bg.endFill();
            cache.bg.lineStyle(1, cHex(d.borderColor), 1); cache.bg.drawRoundedRect(-tw / 2, -th / 2, tw, th, 20);
            cache.bg.beginFill(cHex(d.glowColor), 0.1); cache.bg.drawRoundedRect(-tw / 2 - 5, -th / 2 - 5, tw + 10, th + 10, 25); cache.bg.endFill();
            if (selectedEntity && selectedEntity.id === d.id && selectedEntity.type === 'mini') { cache.bg.lineStyle(2, 0xffffff, 0.7); cache.bg.drawRoundedRect(-tw / 2 - 3, -th / 2 - 3, tw + 6, th + 6, 23); }
            cache.gear.position.set(0, -th / 2 - 12);
        }
        cache.c.position.set(px, py);
    });
}

// Render Links
let animTime = 0;
function renderLinks(fullRebuild = true) {
    let active = new Set(Object.keys(state.links)); if (fullRebuild) { for (let id in pxL) { if (!active.has(id)) { dLC(id); delete partSys[id]; } } }
    Object.values(state.links).forEach(link => {
        if (!link) return; let cache = pxL[link.id];
        if (!cache) {
            let bg = new PIXI.Graphics(), glow = new PIXI.Graphics(), l1 = new PIXI.Graphics(), l2 = new PIXI.Graphics();
            let hit = new PIXI.Container(); hit.eventMode = 'static'; hit.cursor = 'pointer';
            let lblC = new PIXI.Container(), partC = new PIXI.Container();
            layerBg.addChild(bg); layerGlow.addChild(glow); layerLines.addChild(l1); layerLines.addChild(l2); layerHit.addChild(hit);
            layerLbl.addChild(lblC); layerPart.addChild(partC);
            cache = { bg, glow, l1, l2, hit, lblC, partC, sliders: null, lut1: [], lut2: [], pL1: 0, pL2: 0, lblTxt: {}, linkId: link.id }; pxL[link.id] = cache;
            hit._linkId = link.id;
            hit.on('pointerdown', e => {
                if (ctxMenu) ctxMenu.style.display = 'none';

                // Ensure the link is selected when clicked
                selectEntity('link', link.id);
                e.stopPropagation();

                let mx = getMapPt(e).x, my = getMapPt(e).y;

                // Check if an existing point was clicked
                let mD = 10, cp = null;
                const chk = id => { let p = state.points[id]; if (p && p._renderedX != null) { let d = Math.hypot(p._renderedX - mx, p._renderedY - my); if (d < mD) { mD = d; cp = id; } } };
                chk(link.from); chk(link.to); if (link.waypoints) link.waypoints.forEach(chk);

                if (cp) {
                    if (linkingMode) { handleLinking(cp); return; }
                    if (lineCreationMode) { handleLineSeqClick(cp); return; }
                    dragState = { type: 'point', id: cp, isNew: true, sX: e.global.x, sY: e.global.y };
                    return;
                }

                // If no point was clicked, handle link interaction or waypoint insertion
                let ap = getAllPts(link), idx = getCSI({ x: mx, y: my }, ap);
                if (link.type === 'bent') {
                    let pA = ap[idx], pB = ap[idx + 1];
                    let isH = Math.abs(pB.x - pA.x) >= Math.abs(pB.y - pA.y);
                    dragState = { type: 'bend_slider_v2', linkId: link.id, orthoIdx: idx, isH, startX: e.global.x, startY: e.global.y };
                    return;
                }
                if (linkingMode || lineCreationMode) {
                    let ap2 = getAllPts(link);
                    let isDuplicate = false;
                    for (let pt of ap2) {
                        if (Math.hypot(pt.x - mx, pt.y - my) < 10) { isDuplicate = true; break; }
                    }
                    if (isDuplicate) return;

                    let pId = 'p_' + generateId(); state.points[pId] = { x: mx, y: my, attachedTo: null, angle: null };
                    if (link.waypoints) link.waypoints.splice(idx, 0, pId);
                    else link.waypoints = [pId];
                    if (linkingMode) handleLinking(pId);
                    else handleLineSeqClick(pId);
                    return;
                }
                dragState = { type: 'pw', linkId: link.id, insertIdx: idx, sX: e.global.x, sY: e.global.y };
            });
            hit.on('rightclick', e => {
                e.stopPropagation();
                if (lineCreationMode) { stopLineCreationMode(); return; }

                let lk = state.links[hit._linkId]; if (!lk) return;
                let ap = getAllPts(lk), idx = getCSI({ x: e.global.x, y: e.global.y }, ap);

                if (lk.type === 'bent') {
                    // Check if we clicked exactly on one of the generated corners
                    let mx = e.global.x, my = e.global.y, cHit = -1;
                    for (let i = 1; i < ap.length - 1; i++) {
                        if (Math.hypot(ap[i].x - mx, ap[i].y - my) < 15) { cHit = i; break; }
                    }
                    if (cHit !== -1) {
                        // We clicked a corner. Let's provide a context menu to clear the offset.
                        if (!ctxMenu) return; ctxMenu.innerHTML = '';
                        let b = document.createElement('div'); b.className = 'ctx-btn danger'; b.innerText = 'Сбросить изгиб (Удалить угол)';
                        b.onclick = ev => {
                            ev.stopPropagation(); ctxMenu.style.display = 'none';
                            let sgIdx = Math.floor(cHit / 3);
                            if (lk.bOffsets && lk.bOffsets[sgIdx]) {
                                lk.bOffsets[sgIdx] = 0;
                                queueRender(); saveState();
                            }
                        };
                        ctxMenu.appendChild(b);

                        let bProps = document.createElement('div'); bProps.className = 'ctx-btn'; bProps.innerText = '⚙️ Свойства линии';
                        bProps.onclick = ev => { ev.stopPropagation(); ctxMenu.style.display = 'none'; selectEntity('link', lk.id, true); };
                        ctxMenu.appendChild(bProps);

                        ctxMenu.style.left = e.global.x + 15 + 'px'; ctxMenu.style.top = e.global.y + 15 + 'px'; ctxMenu.style.display = 'flex';
                        return;
                    }
                    idx = Math.floor(idx / 3);
                }
                openIPM(lk.id, idx, e.global.x, e.global.y);
            });
            hit.on('pointerover', e => { hoveredLinkId = hit._linkId; queueRender(); });
            hit.on('pointerout', e => { if (hoveredLinkId === hit._linkId) { hoveredLinkId = null; queueRender(); } });

            // Ensure ghost line updates as the mouse moves
            app.stage.on('pointermove', () => {
                if (lineCreationMode || linkingMode) queueRender();
            });
        }

        let c1 = getEC(link, 1), c2 = getEC(link, 2);
        let at1 = c1.at, at2 = c2.at;
        let isDash1 = at1.includes('dash') || at1.includes('dots'), isDash2 = at2.includes('dash') || at2.includes('dots');
        let rawHid = link.hideLines || (link.useGlobalAnim !== false && state.globalAnimConfig.hideLines);
        // Do not hide the primary line if it is currently acting as the animated dashes/dots, unless it's a particle track.
        let hid1 = rawHid && (!isDash1 || c1.isP);
        let hid2 = rawHid && (!isDash2 || c2.isP);

        let hP = id => {
            let p = state.points[id]; if (!p) return '0';
            if (p.attachedTo) { let b = state.bubbles[p.attachedTo] || state.minis[p.attachedTo]; return b ? (b.x || 0).toFixed(1) + ',' + (b.y || 0).toFixed(1) : '0'; }
            return (p.x || 0).toFixed(1) + ',' + (p.y || 0).toFixed(1);
        };
        let cheapHash = hP(link.from) + '|' + hP(link.to);
        if (link.waypoints) link.waypoints.forEach(w => { cheapHash += '|' + hP(w); });
        cheapHash += '|' + (link.bOffsets ? link.bOffsets.join(',') : '');

        cheapHash += '|' + link.type + '|' + link.lineMode + '|' + link.gap + '|' + link.color1 + '|' + link.width1 + '|' + link.color2 + '|' + link.width2 + '|' + link.hasBg + '|' + link.bgColor + '|' + link.bgWidth + '|' + link.hasGlow + '|' + link.glowOpacity;

        let localNeedsRender = fullRebuild || cache.cheapHash !== cheapHash || !cache.ap;

        let ap = localNeedsRender ? getAllPts(link) : cache.ap;

        if (localNeedsRender) {
            cache.cheapHash = cheapHash;
            cache.ap = ap;
            if (state.points) {
                let pF = state.points[link.from]; if (pF && ap[0]) { pF._renderedX = ap[0].x; pF._renderedY = ap[0].y; }
                if (link.waypoints) link.waypoints.forEach((wId, i) => { let wp = state.points[wId]; if (wp && ap[i + 1]) { wp._renderedX = ap[i + 1].x; wp._renderedY = ap[i + 1].y; } });
                let pT = state.points[link.to]; if (pT && ap.length > 0) { pT._renderedX = ap[ap.length - 1].x; pT._renderedY = ap[ap.length - 1].y; }
            }
            let p1 = link.lineMode === 'double' ? getOff(ap, -(link.gap || 0) / 2) : ap;
            let p2 = link.lineMode === 'double' ? getOff(ap, (link.gap || 0) / 2) : [];
            cache.lut1 = buildLUT(p1, link.type); cache.pL1 = lutLen(cache.lut1);
            cache.lut2 = link.lineMode === 'double' ? buildLUT(p2, link.type) : []; cache.pL2 = lutLen(cache.lut2);
            cache.p1 = p1; cache.p2 = p2;

            cache.bg.clear(); if (link.hasBg && !rawHid) drawPath(cache.bg, ap, link.type, cHex(link.bgColor), link.bgWidth || 20, cAlpha(link.bgColor));
            cache.glow.clear();
            if (link.hasGlow !== false && !rawHid) { let gO = link.glowOpacity != null ? link.glowOpacity : 0.3; drawPath(cache.glow, p1, link.type, cHex(link.color1), (link.width1 || 2) + 8, gO); if (link.lineMode === 'double') drawPath(cache.glow, p2, link.type, cHex(link.color2), (link.width2 || 2) + 8, gO * 0.8); }
            if ((hoveredLinkId === link.id || (selectedEntity && selectedEntity.type === 'link' && selectedEntity.id === link.id)) && !rawHid) { cache.glow.clear(); drawPath(cache.glow, p1, link.type, 0xffffff, (link.width1 || 2) + 10, 0.5); }

            let hpSrc = cache.lut1 && cache.lut1.length >= 2 ? cache.lut1 : ap;
            if (hpSrc.length >= 2) {
                let hp = []; for (let i = 0; i < hpSrc.length; i++) { let prev = i === 0 ? hpSrc[0] : hpSrc[i - 1], next = i === hpSrc.length - 1 ? hpSrc[i] : hpSrc[i + 1]; let dx = next.x - prev.x, dy = next.y - prev.y, len = Math.hypot(dx, dy) || 1; hp.push(hpSrc[i].x + (-dy / len) * 20, hpSrc[i].y + (dx / len) * 20); }
                for (let i = hpSrc.length - 1; i >= 0; i--) { let prev = i === 0 ? hpSrc[0] : hpSrc[i - 1], next = i === hpSrc.length - 1 ? hpSrc[i] : hpSrc[i + 1]; let dx = next.x - prev.x, dy = next.y - prev.y, len = Math.hypot(dx, dy) || 1; hp.push(hpSrc[i].x - (-dy / len) * 20, hpSrc[i].y - (dx / len) * 20); }
                cache.hit.hitArea = new PIXI.Polygon(hp);
            } else { cache.hit.hitArea = new PIXI.Polygon([0, 0, 1, 0, 1, 1, 0, 1]); }

            let curL = new Set((link.labels || []).map(l => l.id)); for (let lid in cache.lblTxt) { if (!curL.has(lid)) { cache.lblTxt[lid].destroy(); delete cache.lblTxt[lid]; } }
            if (link.labels) link.labels.forEach(lbl => {
                if (!lbl) return; let t = cache.lblTxt[lbl.id];
                if (!t) {
                    t = new PIXI.Text('', { fontFamily: 'Segoe UI', fontSize: 13, fontWeight: '600', fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 }); t.anchor.set(0.5, 0.5); t.eventMode = 'static'; t.cursor = 'pointer';
                    t.on('pointerdown', e => { e.stopPropagation(); if (!linkingMode) selectEntity('link', link.id); }); cache.lblC.addChild(t); cache.lblTxt[lbl.id] = t;
                }
                t.text = lbl.text || ''; let pt = getPtOnPoly(ap, lbl.offset || 0);
                if (lbl.type === 'callout') { let dx = pt.x > innerWidth / 2 ? -1 : 1, dy = pt.y > innerHeight / 2 ? -1 : 1; t.position.set(pt.x + 60 * dx, pt.y + 20 * dy); t.rotation = 0; }
                else { let pt2 = getPtOnPoly(ap, Math.min(1, (lbl.offset || 0) + 0.01)); let a = Math.atan2(pt2.y - pt.y, pt2.x - pt.x); if (a > Math.PI / 2 || a < -Math.PI / 2) a += Math.PI; t.rotation = a; t.position.set(pt.x, pt.y - 10); }
            });
        }

        let lA1 = hid1 ? 0 : 1, lA2 = hid2 ? 0 : 1;
        let c1H = cHex(link.color1), c2H = cHex(link.color2);

        let gSMode = state.globalAnimConfig.speedMode || 'abs', gSVal = state.globalAnimConfig.speed !== undefined ? parseFloat(state.globalAnimConfig.speed) : 50;
        let l1M = link.l1SpeedMode || 'abs', l1S = link.speed1 !== undefined ? parseFloat(link.speed1) : 50;
        let l2M = link.l2SpeedMode || 'abs', l2S = link.speed2 !== undefined ? parseFloat(link.speed2) : 50;

        let vAbs1 = l1M === 'abs' ? l1S : (cache.pL1 > 0 ? cache.pL1 / Math.max(0.1, l1S) : 50);
        let vAbs2 = l2M === 'abs' ? l2S : (cache.pL2 > 0 ? cache.pL2 / Math.max(0.1, l2S) : 50);

        if (link.useGlobalAnim !== false) {
            vAbs1 = gSMode === 'abs' ? gSVal : (cache.pL1 > 0 ? cache.pL1 / Math.max(0.1, gSVal) : 50);
            vAbs2 = gSMode === 'abs' ? gSVal : (cache.pL2 > 0 ? cache.pL2 / Math.max(0.1, gSVal) : 50);
        }

        let sp1 = vAbs1 / 60; // pixels per frame
        let sp2 = vAbs2 / 60; // pixels per frame

        // Dashed lines should ALWAYS render as dashed if isDash1 is true.
        // Optimization: rebuilding Graphics Paths every frame tanks FPS. Throttle Dash regeneration to every 3rd frame.
        cache.dashTick = (cache.dashTick || 0) + 1;
        let shouldRedrawL1 = fullRebuild || (isDash1 && !c1.isP && !hid1 && (cache.dashTick % 3 === 0 || localNeedsRender));
        if (shouldRedrawL1) {
            cache.l1.clear();
            if (isDash1 && !c1.isP && !hid1) { let dL = at1.includes('dots') ? 1 : 15, gL = 15, dir = at1.includes('bwd') ? 1 : -1; if (link.l1Reverse) dir *= -1; drawDash(cache.l1, cache.lut1, c1H, link.width1 || 2, 1, dL, gL, animTime * sp1 * dir); }
            else if (!c1.isP) drawPath(cache.l1, cache.p1 || ap, link.type, c1H, link.width1 || 2, lA1);
            else if (!hid1) drawPath(cache.l1, cache.p1 || ap, link.type, c1H, Math.max(1, (link.width1 || 2) * 0.3), lA1 * 0.3);
        }

        if (link.lineMode === 'double') {
            let shouldRedrawL2 = fullRebuild || (isDash2 && !c2.isP && !hid2 && (cache.dashTick % 3 === 0 || localNeedsRender));
            if (shouldRedrawL2) {
                cache.l2.clear();
                if (isDash2 && !c2.isP && !hid2) { let dL = at2.includes('dots') ? 1 : 15, gL = 15, dir = at2.includes('bwd') ? 1 : -1; if (link.l2Reverse) dir *= -1; drawDash(cache.l2, cache.lut2, c2H, link.width2 || 2, 1, dL, gL, animTime * sp2 * dir); }
                else if (!c2.isP) drawPath(cache.l2, cache.p2 || [], link.type, c2H, link.width2 || 2, lA2);
                else if (!hid2) drawPath(cache.l2, cache.p2 || [], link.type, c2H, Math.max(1, (link.width2 || 2) * 0.3), lA2 * 0.3);
            }
        }

        // Particles
        if (!partSys[link.id]) partSys[link.id] = []; let pArr = partSys[link.id];

        let pAnim1 = c1.isP;
        let pAnim2 = link.lineMode === 'double' && c2.isP;

        // Only spawn new particles if animation is playing
        if (state.animationMode === 'play') {
            if (pAnim1) {
                let V1 = sp1;
                let D1 = 40 / (parseFloat(c1.count) || 1);
                let bw1 = (link.animType1 && link.animType1.includes('bwd')) || link.l1Reverse;
                if (cache.pL1 > 0) {
                    let bs1 = V1 / cache.pL1;
                    cache.sA1 = (cache.sA1 || 0) + (V1 / D1);
                    while (cache.sA1 >= 1) {
                        cache.sA1 -= 1;
                        let em = [...(c1.emojis || '✨')];
                        pArr.push({ t: bw1 ? 1 : 0, speed: bs1 * (bw1 ? -1 : 1), li: 1, sym: em[Math.floor(Math.random() * em.length)] || '✨', offY: (Math.random() - 0.5) * (c1.wobble || 0), sprite: null });
                    }
                }
            }
            if (pAnim2) {
                let V2 = sp2;
                let D2 = 40 / (parseFloat(c2.count) || 1);
                let bw2 = (link.animType2 && link.animType2.includes('bwd')) || link.l2Reverse;
                if (cache.pL2 > 0) {
                    let bs2 = V2 / cache.pL2;
                    cache.sA2 = (cache.sA2 || 0) + (V2 / D2);
                    while (cache.sA2 >= 1) {
                        cache.sA2 -= 1;
                        let em = [...(c2.emojis || '✨')];
                        pArr.push({ t: bw2 ? 1 : 0, speed: bs2 * (bw2 ? -1 : 1), li: 2, sym: em[Math.floor(Math.random() * em.length)] || '✨', offY: (Math.random() - 0.5) * (c2.wobble || 0), sprite: null });
                    }
                }
            }
        }

        for (let i = pArr.length - 1; i >= 0; i--) {
            let p = pArr[i];
            let isL1 = p.li === 1;
            let isActiveAnim = isL1 ? pAnim1 : pAnim2;
            let isVisAnim = (isL1 ? c1.isP : c2.isP) && state.animationMode !== 'solid';

            if (state.animationMode === 'play' && isActiveAnim) p.t += p.speed;

            if (p.t > 1 || p.t < 0) { if (p.sprite) p.sprite.destroy(); pArr.splice(i, 1); continue; }

            let lut = isL1 ? cache.lut1 : cache.lut2;
            if (!lut || lut.length < 2) { if (p.sprite) p.sprite.destroy(); pArr.splice(i, 1); continue; }

            if (!isVisAnim) {
                // If the user turned OFF particle rendering entirely for this line, DESTROY the old particles
                // to free up CPU / Memory immediately rather than keeping stale cache.
                // However, we only destroy if they aren't meant to be paused.
                // state.animationMode === 'solid' means global solid, c1.isP means track changed to simple dashed.
                // If it's just paused (isVisAnim is true when paused), this block isn't hit.
                if (p.sprite) p.sprite.destroy();
                pArr.splice(i, 1);
                continue;
            }

            let pt = getLPt(lut, p.t), tN = Math.min(1, p.t + 0.005), ptN = getLPt(lut, tN);
            let ang = Math.atan2(ptN.y - pt.y, ptN.x - pt.x);
            let x = pt.x + Math.cos(ang + Math.PI / 2) * p.offY, y = pt.y + Math.sin(ang + Math.PI / 2) * p.offY;
            let bw = (isL1 ? link.width1 : link.width2) || 2, cc = isL1 ? c1 : c2;
            let r = bw * 1.5 * cc.size, col = isL1 ? (link.color1 || '#00ffcc') : (link.color2 || '#ff00ff'), mode = cc.mode;

            if (!p.sprite) {
                if (mode === 'pixi_symbols') { p.sprite = new PIXI.Sprite(gSymTex(p.sym, r, col)); }
                else if (mode === 'pixi_energy') { p.sprite = new PIXI.Sprite(gEnTex(col, r)); }
                else { p.sprite = new PIXI.Sprite(gShTex(cc.shape, col, r)); }
                p.sprite.anchor.set(0.5, 0.5); cache.partC.addChild(p.sprite);
            }

            p.sprite.visible = true;
            p.sprite.position.set(x, y);
            if (mode === 'pixi_shapes' || mode === 'pixi_energy') p.sprite.rotation = ang + Math.PI / 2;
            // Emojis typically shouldn't rotate upside down for purely stylistic layout, but if user wants it, leave it out for emojis.
        }

        let showSliders = link.type === 'bent' && ((selectedEntity && selectedEntity.type === 'link' && selectedEntity.id === link.id) || hoveredLinkId === link.id);
        if (!cache.sliders) { cache.sliders = new PIXI.Container(); layerHit.addChild(cache.sliders); }
        cache.sliders.visible = showSliders && !rawHid;

        if (!cache.sliders.visible) {
            if (cache.sliders.children.length > 0) {
                cache.sliders.children.forEach(c => c.destroy(true));
                cache.sliders.removeChildren();
            }
        }

        let lMode = linkingMode || lineCreationMode || dragState;
        if (link.type === 'bent' && cache.sliders.visible && (localNeedsRender || lMode || !cache.sliders.children.length)) {
            cache.sliders.children.forEach(c => c.destroy(true));
            cache.sliders.removeChildren();
            let bPts = ap;
            let rawP = [link.from, ...(link.waypoints || []), link.to].map(getRaw);
            let oPts = [getPC(link.from, rawP.length > 1 ? rawP[1] : null)];
            if (link.waypoints) link.waypoints.forEach(w => oPts.push(getPC(w)));
            oPts.push(getPC(link.to, rawP.length > 1 ? rawP[rawP.length - 2] : null));

            if ((linkingMode && linkingSourcePointId === link.from) || (lineCreationMode && currentLineId === link.id)) {
                let lastPC = getPC(link.to, null);
                let sTr = new PIXI.Graphics();
                let curPosRaw = app.renderer.events.pointer.global;
                let curPos = { x: (curPosRaw.x - worldContainer.x) / worldContainer.scale.x, y: (curPosRaw.y - worldContainer.y) / worldContainer.scale.y };
                sTr.lineStyle(2, lineCreationMode ? cHex(link.color1) : 0xffffff, 0.5);

                if (link.type === 'bent') {
                    let isHoriz = Math.abs(curPos.x - lastPC.x) >= Math.abs(curPos.y - lastPC.y);
                    sTr.moveTo(lastPC.x, lastPC.y);
                    if (isHoriz) {
                        let mx = (lastPC.x + curPos.x) / 2;
                        sTr.lineTo(mx, lastPC.y);
                        sTr.lineTo(mx, curPos.y);
                        sTr.lineTo(curPos.x, curPos.y);
                    } else {
                        let my = (lastPC.y + curPos.y) / 2;
                        sTr.lineTo(lastPC.x, my);
                        sTr.lineTo(curPos.x, my);
                        sTr.lineTo(curPos.x, curPos.y);
                    }
                } else {
                    sTr.moveTo(lastPC.x, lastPC.y);
                    sTr.lineTo(curPos.x, curPos.y);
                }
                cache.sliders.addChild(sTr);
            }
            for (let i = 0; i < bPts.length - 1; i++) {
                let pA = bPts[i], pB = bPts[i + 1];
                let sIdx = Math.floor(i / 3);
                let oA = oPts[sIdx], oB = oPts[sIdx + 1]; if (!oA || !oB) continue;
                let isOuterHoriz = Math.abs(oB.x - oA.x) >= Math.abs(oB.y - oA.y);

                let isH;
                if (i % 3 === 1) isH = !isOuterHoriz;
                else isH = isOuterHoriz;

                let dx = Math.abs(pB.x - pA.x), dy = Math.abs(pB.y - pA.y);
                if (dx < 5 && dy < 5) continue; // Skip zero-length or ultra short

                let mx = (pA.x + pB.x) / 2, my = (pA.y + pB.y) / 2;

                let s = new PIXI.Graphics();
                s.beginFill(0x5e6ad2);
                if (isH) s.drawRoundedRect(-13.5, -5, 27, 10, 5);
                else s.drawRoundedRect(-5, -13.5, 10, 27, 5);
                s.endFill();
                s.lineStyle(2, 0xffffff);
                if (isH) s.drawRoundedRect(-13.5, -5, 27, 10, 5);
                else s.drawRoundedRect(-5, -13.5, 10, 27, 5);

                s.position.set(mx, my);
                s.eventMode = 'static';
                s.cursor = isH ? 'ns-resize' : 'ew-resize';
                s.on('pointerdown', e => {
                    e.stopPropagation();
                    if (ctxMenu) ctxMenu.style.display = 'none';
                    selectEntity('link', link.id);
                    dragState = { type: 'bend_slider_v2', linkId: link.id, orthoIdx: i, isH, startX: e.global.x, startY: e.global.y };
                });

                s.on('rightclick', e => {
                    e.stopPropagation();
                    let lk = state.links[link.id];
                    if (!lk || !ctxMenu) return; ctxMenu.innerHTML = '';
                    let b = document.createElement('div'); b.className = 'ctx-btn'; b.innerText = 'Создать независимую точку';
                    b.onclick = ev => {
                        ev.stopPropagation(); ctxMenu.style.display = 'none';
                        let pId = 'p_' + generateId();
                        state.points[pId] = { x: mx, y: my, attachedTo: null, angle: null };
                        if (!lk.waypoints) lk.waypoints = [];
                        let wIdx = Math.floor(i / 3);
                        if (i % 3 >= 1) wIdx++;
                        lk.waypoints.splice(wIdx, 0, pId);
                        lk.bOffsets = [];
                        queueRender(); saveState();
                    };
                    ctxMenu.appendChild(b);
                    ctxMenu.style.left = e.global.x + 15 + 'px'; ctxMenu.style.top = e.global.y + 15 + 'px'; ctxMenu.style.display = 'flex';
                });
                cache.sliders.addChild(s);
            }
        }


    });
}

// Render Points
function renderPoints() {
    let active = new Set(Object.keys(state.points)); for (let id in pxP) { if (!active.has(id)) { pxP[id].g.destroy(); delete pxP[id]; } }
    for (let pId in state.points) {
        let pd = state.points[pId]; if (!pd) continue; let u = getPU(pId);
        if (u === 0 && pId !== linkingSourcePointId && (!dragState || dragState.id !== pId)) { delete state.points[pId]; if (pxP[pId]) { pxP[pId].g.destroy(); delete pxP[pId]; } continue; }
        let cache = pxP[pId]; if (!cache) {
            let g = new PIXI.Graphics(); g.eventMode = 'static'; g.cursor = 'grab'; layerPts.addChild(g); cache = { g }; pxP[pId] = cache;
            g.on('pointerdown', e => {
                e.stopPropagation();
                if (ctxMenu) ctxMenu.style.display = 'none';
                if (linkingMode) { handleLinking(pId); return; }
                if (lineCreationMode) { handleLineSeqClick(pId); return; }
                dragState = { type: 'point', id: pId, isNew: true, sX: e.global.x, sY: e.global.y };
            });
            g.on('rightclick', e => { e.stopPropagation(); openRPM(pId, { clientX: e.global.x, clientY: e.global.y }); });
        }
        let cx = pd._renderedX != null ? pd._renderedX : (pd.x || 0), cy = pd._renderedY != null ? pd._renderedY : (pd.y || 0);
        let isLinkSel = false, isLinkHov = false;
        Object.values(state.links).forEach(l => { if (!l) return; if (l.from === pId || l.to === pId || (l.waypoints && l.waypoints.includes(pId))) { if (selectedEntity && selectedEntity.type === 'link' && selectedEntity.id === l.id) isLinkSel = true; if (hoveredLinkId === l.id) isLinkHov = true; } });
        let isDr = dragState && dragState.id === pId, show = linkingMode || isLinkSel || isLinkHov || isDr || pId === linkingSourcePointId;
        cache.g.clear(); if (show) { let col = u > 1 ? 0xf39c12 : 0x2ecc71; cache.g.beginFill(col, 1); cache.g.drawCircle(0, 0, 8); cache.g.endFill(); cache.g.lineStyle(2, 0xffffff, 1); cache.g.drawCircle(0, 0, 8); }
        cache.g.position.set(cx, cy); cache.g.eventMode = show ? 'static' : 'none'; cache.g.visible = show;
    }
}

// Drag state
document.addEventListener('mousemove', e => {
    if (!dragState) return;
    let invS = 1 / worldContainer.scale.x;
    if (dragState.type === 'bend_slider_v2' || dragState.type === 'bend_corner') {
        let link = state.links[dragState.linkId];
        if (link) {
            let rawP = [link.from, ...(link.waypoints || []), link.to].map(getRaw);
            let oPts = [getPC(link.from, rawP.length > 1 ? rawP[1] : null)];
            if (link.waypoints) link.waypoints.forEach(w => oPts.push(getPC(w)));
            oPts.push(getPC(link.to, rawP.length > 1 ? rawP[rawP.length - 2] : null));
            if (!link.bOffsets) link.bOffsets = [];

            if (dragState.type === 'bend_slider_v2') {
                let sIdx = Math.floor(dragState.orthoIdx / 3);
                let posInBend = dragState.orthoIdx % 3;
                let oA = oPts[sIdx], oB = oPts[sIdx + 1]; if (!oA || !oB) return;
                let isOuterHoriz = Math.abs(oB.x - oA.x) >= Math.abs(oB.y - oA.y);

                let moveDelta = 0, valToUpdate = sIdx;

                if (posInBend === 1) { // Middle leg uses primary offset logic natively
                    moveDelta = dragState.isH ? (e.clientY - dragState.startY) : (e.clientX - dragState.startX);
                } else { // Outer legs dragging alters adjacent offsets (which isn't strictly 1-to-1 in current architecture)
                    // We map the delta horizontally/vertically back to the central offset conceptually
                    // For now, dragging outer legs will slide the entire block along its primary axis.
                    // This creates native feel. 
                    moveDelta = isOuterHoriz ? (e.clientX - dragState.startX) : (e.clientY - dragState.startY);
                }

                moveDelta *= invS; // Scale to map coords

                if (dragState.startOff === undefined) dragState.startOff = link.bOffsets[valToUpdate] || 0;
                let newOff = dragState.startOff + moveDelta;
                if (Math.abs(newOff) < 15) newOff = 0; // Auto-merge parallel segments if close
                link.bOffsets[valToUpdate] = newOff;
            }

            if (dragState.type === 'bend_corner') {
                let sIdx = Math.floor(dragState.cornerIdx / 3);
                let oA = oPts[sIdx], oB = oPts[sIdx + 1]; if (!oA || !oB) return;
                let isOuterHoriz = Math.abs(oB.x - oA.x) >= Math.abs(oB.y - oA.y);

                // Dragging a corner alters both X and Y components.
                // Depending on the primary axis, we map the X or Y delta to the primary offset.
                let dx = e.clientX - dragState.startX, dy = e.clientY - dragState.startY;
                if (dragState.startOff === undefined) dragState.startOff = link.bOffsets[sIdx] || 0;

                let newOff = dragState.startOff + ((isOuterHoriz ? dx : dy) * invS);
                if (Math.abs(newOff) < 15) newOff = 0;
                link.bOffsets[sIdx] = newOff;
            }

            queueRender();
        }
        return;
    }

    if (dragState.type === 'pw') {
        let dist = Math.hypot(e.clientX - dragState.sX, e.clientY - dragState.sY);
        if (dist > 5 && state.links[dragState.linkId]) {
            let mp = getMapPt({ global: { x: dragState.sX, y: dragState.sY } });
            let pId = 'p_' + generateId(); state.points[pId] = { x: mp.x, y: mp.y, attachedTo: null, angle: null };
            state.links[dragState.linkId].waypoints.splice(dragState.insertIdx, 0, pId); let old = dragState.linkId; dragState = { type: 'point', id: pId, isNew: false, sX: dragState.sX, sY: dragState.sY }; selectEntity('link', old);
        }
    }
    if (dragState.type === 'point' && state.points[dragState.id]) {
        let mp = getMapPt({ global: { x: e.clientX, y: e.clientY } });
        if (dragState.isNew && Math.hypot(e.clientX - dragState.sX, e.clientY - dragState.sY) > 5) dragState.isNew = false;
        let pId = dragState.id, mx = mp.x, my = mp.y, sn = null, sR = 30 * invS, mS = Infinity;
        const chk = (id, cx, cy, type, angle, pri) => { let d = Math.hypot(cx - mx, cy - my); if (d < sR) { let sc = d - pri * 1000; if (sc < mS) { mS = sc; sn = { id, type, angle }; } } };
        for (let id in state.bubbles) { let b = state.bubbles[id]; if (b) chk(id, b.x + b.size / 2, b.y + b.size / 2, 'center', null, 1); }
        for (let id in state.minis) { let c = getBC(id); if (c) chk(id, c.x, c.y, 'center', null, 1); }
        for (let id in state.bubbles) { let b = state.bubbles[id]; if (!b) continue; let c = { x: b.x + b.size / 2, y: b.y + b.size / 2, rect: { width: b.size, height: b.size } }; let a = Math.atan2(my - c.y, mx - c.x), ep = getEI(id, c, c.x + Math.cos(a) * 1000, c.y + Math.sin(a) * 1000); chk(id, ep.x, ep.y, 'contour', a, 0); }
        for (let id in pxP) { if (id !== pId && pxP[id]) chk(id, pxP[id].g.position.x, pxP[id].g.position.y, 'point', null, 3); }
        dragState.sn = sn;
        if (sn) {
            if (sn.type === 'contour') state.points[pId] = { attachedTo: sn.id, angle: sn.angle };
            else if (sn.type === 'center') state.points[pId] = { attachedTo: sn.id, angle: null };
            else { let tg = pxP[sn.id]; if (tg) state.points[pId] = { x: tg.g.position.x, y: tg.g.position.y, attachedTo: null, angle: null }; }
        }
        else state.points[pId] = { x: mx, y: my, attachedTo: null, angle: null }; queueRender();
    }
});

function cleanupBentWaypoints(linkId) {
    let link = state.links[linkId];
    if (!link || link.type !== 'bent' || !link.waypoints || link.waypoints.length === 0) return;
    let changed = false;
    let rPts = [link.from, ...link.waypoints, link.to];
    for (let i = 1; i < rPts.length - 1; i++) {
        let pId = rPts[i];
        let pPrev = rPts[i - 1], pNext = rPts[i + 1];
        let pp = state.points[pPrev] || getRaw(pPrev), pc = state.points[pId] || getRaw(pId), pn = state.points[pNext] || getRaw(pNext);
        let dx1 = pc.x - pp.x, dy1 = pc.y - pp.y, dx2 = pn.x - pc.x, dy2 = pn.y - pc.y;

        let d1 = Math.hypot(dx1, dy1), d2 = Math.hypot(dx2, dy2);
        let isCollinear = false;
        if (d1 < 1 || d2 < 1) isCollinear = true;
        else if ((dx1 / d1) * (dx2 / d2) + (dy1 / d1) * (dy2 / d2) > 0.99) isCollinear = true;

        if (isCollinear && getPU(pId) <= 1) {
            let idx = link.waypoints.indexOf(pId);
            if (idx !== -1) {
                link.waypoints.splice(idx, 1);
                delete state.points[pId];
                changed = true;
                break;
            }
        }
    }
    if (changed) cleanupBentWaypoints(linkId);
}

document.addEventListener('mouseup', e => {
    if (!dragState) return;
    if (dragState.type === 'bend_slider_v2' || dragState.type === 'bend_corner') {
        cleanupBentWaypoints(dragState.linkId);
        saveState();
        dragState = null;
        return;
    }
    if (dragState.type === 'pw') {
        // Simple click on link (no drag) — just keep the selection that was already set in pointerdown
        dragState = null; queueRender(); return;
    }
    if (dragState.type === 'point') {
        let pId = dragState.id; if (dragState.isNew) openRPM(pId, e);
        else {
            if (dragState.sn && dragState.sn.type === 'point') {
                let tId = dragState.sn.id;
                Object.values(state.links).forEach(l => {
                    if (!l) return;
                    if (l.from === pId) l.from = tId;
                    if (l.to === pId) l.to = tId;
                    if (l.waypoints) l.waypoints = l.waypoints.map(w => w === pId ? tId : w);
                });
                delete state.points[pId];
            }
            saveState();
        }
        Object.values(state.links).forEach(l => {
            if (l && l.waypoints && l.waypoints.includes(pId)) cleanupBentWaypoints(l.id);
        });
    } dragState = null;
});

// Click empty space removed (merged to main pointerdown)

// Right click empty space
app.stage.on('rightclick', e => {
    if (!currentUser) return;
    if (e.target !== app.stage) return;
    if (!ctxMenu) return; ctxMenu.innerHTML = '';

    const mkBtn = (txt, fn) => {
        let b = document.createElement('div'); b.className = 'ctx-btn'; b.innerText = txt;
        b.onclick = ev => { ev.stopPropagation(); ctxMenu.style.display = 'none'; fn(); };
        ctxMenu.appendChild(b);
    };

    mkBtn('🟡 Создать Бабл', () => {
        let id = 'main_' + generateId(), size = 200;
        let mp = getMapPt(e);
        state.bubbles[id] = { id, name: 'Бабл', x: mp.x - size / 2, y: mp.y - size / 2, size, shape: 'circle', bgColor: 'rgba(255,0,100,0.1)', borderColor: '#ff0066', glowColor: '#ff0066' };
        queueRender(); selectEntity('main', id); saveState();
    });
    mkBtn('🔗 Создать связь', () => {
        let mp = getMapPt(e);
        let pId = 'p_' + generateId(); state.points[pId] = { x: mp.x, y: mp.y, attachedTo: null, angle: null };
        linkingMode = true; linkingSourcePointId = null;
        let btnMc = document.getElementById('btn-master-create'); if (btnMc) btnMc.classList.add('active');
        let lt = document.getElementById('link-tools'); if (lt) lt.style.display = 'flex';
        handleLinking(pId);
    });
    mkBtn('➖ Создать линию', () => {
        startLineCreationMode();
        let mp = getMapPt(e);
        let pId = 'p_' + generateId(); state.points[pId] = { x: mp.x, y: mp.y, attachedTo: null, angle: null };
        handleLineSeqClick(pId);
    });

    ctxMenu.style.left = e.global.x + 15 + 'px'; ctxMenu.style.top = e.global.y + 15 + 'px'; ctxMenu.style.display = 'flex';
});

// Create Line Sequential Mode
function startLineCreationMode() {
    lineCreationMode = true; currentLineId = null;
    let b = document.getElementById('btn-master-create'); if (b) b.classList.add('active');
    let lt = document.getElementById('link-tools'); if (lt) lt.style.display = 'flex';
    document.body.style.cursor = 'crosshair';
}
function stopLineCreationMode() {
    lineCreationMode = false; currentLineId = null;
    let b = document.getElementById('btn-master-create'); if (b) b.classList.remove('active');
    let lt = document.getElementById('link-tools'); if (lt) lt.style.display = 'none';
    document.body.style.cursor = 'default';
    queueRender(); saveState();
}

// Linking
function handleLinking(pId) {
    if (linkingSourcePointId && !state.points[linkingSourcePointId]) linkingSourcePointId = null;
    if (!linkingSourcePointId) { linkingSourcePointId = pId; linkingMode = true; let b = document.getElementById('btn-link'); if (b) b.classList.add('active'); let t = document.getElementById('link-tools'); if (t) t.style.display = 'flex'; queueRender(); }
    else {
        if (linkingSourcePointId !== pId) {
            let nId = 'link_' + generateId(); let ltT = document.getElementById('lt-type'), ltM = document.getElementById('lt-mode'), ltC = document.getElementById('lt-color');
            state.links[nId] = { id: nId, from: linkingSourcePointId, to: pId, labels: [], type: ltT ? ltT.value : defaultLP.type, lineMode: ltM ? ltM.value : defaultLP.lineMode, gap: 10, waypoints: [], hasGlow: true, glowOpacity: 0.3, hasBg: false, bgColor: 'rgba(255,255,255,0.1)', bgWidth: 20, color1: ltC ? ltC.value : defaultLP.color, width1: 2, animType1: 'pixi_dash_fwd', speed1: 5, color2: '#ff00ff', width2: 2, animType2: 'none', speed2: 5, useGlobalAnim: true, hideLines: false };
        }
        linkingMode = false; linkingSourcePointId = null; let b = document.getElementById('btn-link'); if (b) b.classList.remove('active'); let t = document.getElementById('link-tools'); if (t) t.style.display = 'none'; queueRender(); saveState();
    }
}

let blBtn = document.getElementById('btn-link');
if (blBtn) blBtn.onclick = () => { linkingMode = !linkingMode; linkingSourcePointId = null; let t = document.getElementById('link-tools'); if (linkingMode) { blBtn.classList.add('active'); if (t) t.style.display = 'flex'; } else { blBtn.classList.remove('active'); if (t) t.style.display = 'none'; } queueRender(); };

// Main loop
function queueRender() { needsRender = true; if (!app.ticker.started) app.ticker.start(); }
app.ticker.add(delta => {
    let hasP = false; for (let id in partSys) { if (partSys[id] && partSys[id].length > 0) { hasP = true; break; } }
    let hasAnim = false;
    let isSolidMode = state.animationMode === 'solid';

    Object.values(state.links).forEach(l => {
        if (!l) return;
        let c1 = getEC(l, 1), c2 = getEC(l, 2);
        let hid = l.hideLines || (l.useGlobalAnim !== false && state.globalAnimConfig.hideLines);
        if (!hid && !isSolidMode) {
            if (!c1.isP && (c1.at.includes('dash') || c1.at.includes('dots'))) hasAnim = true;
            if (l.lineMode === 'double' && !c2.isP && (c2.at.includes('dash') || c2.at.includes('dots'))) hasAnim = true;
            if (c1.isP || (l.lineMode === 'double' && c2.isP)) hasAnim = true;
        }
    });

    let isAnimActive = state.animationMode === 'play' && (hasAnim || hasP);

    // Keyboard & Edge Panning Logic
    let isPanning = false;
    let panSpeed = 15;

    // Edge Panning
    let edgeThreshold = 30; // pixels from edge
    if (!cam.isPanningMMB && !dragState && !selectedEntity) { // Avoid panning while dragging objects
        if (globalMouse.x < edgeThreshold) { worldContainer.x += panSpeed; isPanning = true; }
        if (globalMouse.x > innerWidth - edgeThreshold) { worldContainer.x -= panSpeed; isPanning = true; }
        if (globalMouse.y < edgeThreshold) { worldContainer.y += panSpeed; isPanning = true; }
        if (globalMouse.y > innerHeight - edgeThreshold) { worldContainer.y -= panSpeed; isPanning = true; }
    }

    // WASD Panning
    if (keys.w) { worldContainer.y += panSpeed; isPanning = true; }
    if (keys.s) { worldContainer.y -= panSpeed; isPanning = true; }
    if (keys.a) { worldContainer.x += panSpeed; isPanning = true; }
    if (keys.d) { worldContainer.x -= panSpeed; isPanning = true; }

    if (isPanning) {
        if (typeof applyCameraBounds === 'function') applyCameraBounds();
        needsRender = true;
    }

    // Update FPS Counter
    let fpsCounter = document.getElementById('fps-counter');
    if (fpsCounter) {
        fpsCounter.innerText = Math.round(app.ticker.FPS) + ' FPS';
        if (app.ticker.FPS < 30) fpsCounter.style.color = '#ff4444';
        else if (app.ticker.FPS < 50) fpsCounter.style.color = '#ffaa00';
        else fpsCounter.style.color = '#00ffcc';
    }

    if (dragState && dragState.type === 'lasso') {
        // selectionBox is in worldContainer (world-space) — convert screen → world
        const _sc = worldContainer.scale.x;
        const _wx1 = (Math.min(dragState.sX, dragState.curX) - worldContainer.x) / _sc;
        const _wy1 = (Math.min(dragState.sY, dragState.curY) - worldContainer.y) / _sc;
        const _ww  = Math.abs(dragState.curX - dragState.sX) / _sc;
        const _wh  = Math.abs(dragState.curY - dragState.sY) / _sc;
        selectionBox.clear();
        selectionBox.lineStyle(1, 0x00ccff, 0.8);
        selectionBox.beginFill(0x00ccff, 0.1);
        selectionBox.drawRect(_wx1, _wy1, _ww, _wh);
        selectionBox.endFill();
    } else {
        selectionBox.clear();
    }

    if (needsRender || isAnimActive) {
        if (state.animationMode === 'play') animTime += delta;
        let fr = needsRender;
        if (fr) { renderBubbles(); renderMinis(); renderPoints(); }
        renderLinks(fr);
        renderMinimap();
        needsRender = false;
    } else { if (!isPanning) app.ticker.stop(); }
});

// Properties Panel
function gP(id) { return document.getElementById(id); }
const P = {
    nameGrp: gP('prop-name-group'), name: gP('prop-name'), shape: gP('prop-shape'),
    size: gP('prop-size'), szGrp: gP('prop-size-group'), whGrp: gP('prop-wh-group'),
    width: gP('prop-width'), height: gP('prop-height'),
    miniProps: gP('mini-bubble-props'), miniShape: gP('mini-shape'),
    miniRadius: gP('mini-border-radius'), miniW: gP('mini-width'), miniH: gP('mini-height'),
    bg: gP('prop-bg-color'), border: gP('prop-border-color'), glow: gP('prop-glow-color'),
    lUG: gP('prop-link-use-global'), lType: gP('prop-link-type'), lMode: gP('prop-link-mode'), gap: gP('prop-link-gap'),
    bgHas: gP('prop-link-hasbg'), bgCol: gP('prop-link-bgcol'), bgWid: gP('prop-link-bgwid'),
    glHas: gP('prop-link-hasglow'), glOp: gP('prop-link-glowop'),
    l1C: gP('prop-l1-color'), l1W: gP('prop-l1-width'), l1A: gP('prop-l1-anim'), l1S: gP('prop-l1-speed'),
    l2C: gP('prop-l2-color'), l2W: gP('prop-l2-width'), l2A: gP('prop-l2-anim'), l2S: gP('prop-l2-speed')
};

const uVBM = (mode, ws, we, wsl) => { if (ws) ws.style.display = mode === 'pixi_shapes' ? 'flex' : 'none'; if (we) we.style.display = mode === 'pixi_symbols' ? 'flex' : 'none'; if (wsl) wsl.style.display = (mode && mode !== 'pixi_dash') ? 'block' : 'none'; };
const uLUI = (ln, at, uG) => { let isP = at.startsWith('pixi_shapes') || at.startsWith('pixi_energy') || at.startsWith('pixi_symbols'); let wp = gP(`wrap-l${ln}-part-props`); if (wp) wp.style.display = (isP && !uG) ? 'block' : 'none'; if (isP && !uG) { let ws = gP(`wrap-l${ln}-shape`), we = gP(`wrap-l${ln}-emojis`); if (ws) ws.style.display = at === 'pixi_shapes' ? 'flex' : 'none'; if (we) we.style.display = at === 'pixi_symbols' ? 'flex' : 'none'; } };

function renderLP(link) {
    if (!link) return; let c = gP('prop-link-labels-list'); if (!c) return; c.innerHTML = '';
    if (link.labels) link.labels.forEach(lbl => {
        if (!lbl) return; let box = document.createElement('div'); box.className = 'layer-box'; box.style.marginTop = '0';
        box.innerHTML = `<div class="form-group row"><input type="text" value="${escapeHTML(lbl.text || '')}" oninput="updateLabel('${link.id}','${lbl.id}','text',this.value)" onchange="updateLabel('${link.id}','${lbl.id}','text',this.value,true)" style="width:60%"><button class="action-btn" onclick="deleteLabel('${link.id}','${lbl.id}')">Удалить</button></div>
<div class="form-group" style="margin-top:5px;"><select onchange="updateLabel('${link.id}','${lbl.id}','type',this.value,true)"><option value="along" ${lbl.type === 'along' ? 'selected' : ''}>Вдоль линии</option><option value="callout" ${lbl.type === 'callout' ? 'selected' : ''}>Выноска</option></select></div>
<div class="form-group" style="margin-top:5px;"><label style="display:flex;justify-content:space-between">Позиция <span id="pv-${lbl.id}">${Math.round((lbl.offset || 0) * 100)}%</span></label><input type="range" min="0" max="100" value="${(lbl.offset || 0) * 100}" oninput="let e=document.getElementById('pv-${lbl.id}');if(e)e.innerText=this.value+'%';updateLabel('${link.id}','${lbl.id}','offset',this.value/100)" onchange="updateLabel('${link.id}','${lbl.id}','offset',this.value/100,true)"></div>`;
        c.appendChild(box);
    });
}

window.updateLabel = (lid, id, k, v, fin) => { let l = state.links[lid]; if (!l || !l.labels) return; let lbl = l.labels.find(x => x && x.id === id); if (lbl) { lbl[k] = v; queueRender(); if (fin) saveState(); } };
window.deleteLabel = (lid, id) => { let l = state.links[lid]; if (!l || !l.labels) return; l.labels = l.labels.filter(x => x && x.id !== id); renderLP(l); queueRender(); saveState(); };

let bal = document.getElementById('btn-add-label');
if (bal) bal.onclick = () => { if (selectedEntity && selectedEntity.type === 'link') { let l = state.links[selectedEntity.id]; if (l) { if (!l.labels) l.labels = []; l.labels.push({ id: 'lbl_' + generateId(), text: 'Надпись', type: 'callout', offset: 0.5 }); renderLP(l); queueRender(); saveState(); } } };

function selectEntity(type, id, showPanel = false) {
    selectedEntity = type ? { type, id } : null; queueRender();
    let pp = gP('properties-panel');
    if (!selectedEntity) {
        gP('global-props').style.display = 'block'; gP('main-bubble-props').style.display = 'none'; gP('color-props').style.display = 'none'; gP('link-props').style.display = 'none'; gP('entity-actions').style.display = 'none'; P.nameGrp.style.display = 'none'; gP('prop-title').innerText = "Рабочая область";
        let gc = state.globalAnimConfig; gP('prop-global-mode').value = gc.mode || 'pixi_dash'; gP('prop-global-shape').value = gc.shape || 'drop'; gP('prop-global-emojis').value = gc.emojis || '❤️⭐✨'; gP('prop-global-size').value = gc.size || 1; gP('prop-global-count').value = gc.count || 1; gP('prop-global-wobble').value = gc.wobble || 0; gP('prop-global-hidelines').checked = !!gc.hideLines; let eco = gP('prop-global-eco'); if (eco) eco.checked = !!gc.ecoMode;
        uVBM(gc.mode, gP('wrap-global-shape'), gP('wrap-global-emojis'), gP('wrap-global-sliders'));
        if (pp) pp.style.display = 'none';
        return;
    }
    gP('prop-title').innerText = "Свойства"; gP('global-props').style.display = 'none';
    if (pp && showPanel !== false) {
        pp.style.display = 'flex';
        let px = globalMouse.x + 150, py = globalMouse.y - 100;
        if (px + 300 > innerWidth) px = globalMouse.x - 320; // Flip left if right edge hit
        if (py + 400 > innerHeight) py = innerHeight - 420;
        if (py < 10) py = 10;
        pp.style.left = Math.max(10, px) + 'px';
        pp.style.top = py + 'px';
    }
    gP('main-bubble-props').style.display = type === 'main' ? 'block' : 'none';
    if (P.miniProps) P.miniProps.style.display = type === 'mini' ? 'block' : 'none';
    gP('color-props').style.display = (type === 'main' || type === 'mini') ? 'block' : 'none';
    gP('link-props').style.display = type === 'link' ? 'block' : 'none'; gP('entity-actions').style.display = type === 'link' ? 'none' : 'flex';
    P.nameGrp.style.display = type === 'link' ? 'none' : 'flex';
    if (type === 'main') { let b = state.bubbles[id]; if (b) {
        if (P.name) P.name.value = b.name || '';
        if (P.shape) P.shape.value = b.shape || 'circle';
        let isC = b.shape === 'circle';
        if (P.szGrp) P.szGrp.style.display = isC ? '' : 'none';
        if (P.whGrp) P.whGrp.style.display = isC ? 'none' : '';
        if (P.size) P.size.value = b.size || 200;
        if (P.width) P.width.value = _bW(b);
        if (P.height) P.height.value = _bH(b);
        if (P.bg) { P.bg.value = b.bgColor || ''; let m = (b.bgColor || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); if (m) gP('prop-bg-color-picker').value = '#' + (+m[1]).toString(16).padStart(2, '0') + (+m[2]).toString(16).padStart(2, '0') + (+m[3]).toString(16).padStart(2, '0'); }
        if (P.border) P.border.value = b.borderColor || ''; if (P.glow) P.glow.value = b.glowColor || ''; } }
    else if (type === 'mini') { let m = state.minis[id]; if (m) {
        if (P.name) P.name.value = m.name || '';
        if (P.miniShape) P.miniShape.value = m.shape || 'pill';
        if (P.miniRadius) P.miniRadius.value = m.borderRadius != null ? m.borderRadius : 20;
        if (P.miniW) P.miniW.value = m.w || '';
        if (P.miniH) P.miniH.value = m.h || '';
        if (P.bg) { P.bg.value = m.bgColor || ''; let x = (m.bgColor || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); if (x) gP('prop-bg-color-picker').value = '#' + (+x[1]).toString(16).padStart(2, '0') + (+x[2]).toString(16).padStart(2, '0') + (+x[3]).toString(16).padStart(2, '0'); }
        if (P.border) P.border.value = m.borderColor || ''; if (P.glow) P.glow.value = m.glowColor || ''; } }
    else if (type === 'link') {
        let l = state.links[id]; if (!l) return;
        if (P.lUG) P.lUG.checked = l.useGlobalAnim !== false; gP('prop-link-hidelines').checked = !!l.hideLines;
        uLUI(1, l.animType1 || 'none', l.useGlobalAnim !== false); uLUI(2, l.animType2 || 'none', l.useGlobalAnim !== false);
        if (P.lType) P.lType.value = l.type || 'curved'; if (P.lMode) P.lMode.value = l.lineMode || 'single'; if (P.gap) P.gap.value = l.gap || 10;
        if (P.bgHas) P.bgHas.checked = !!l.hasBg; if (P.bgCol) P.bgCol.value = l.bgColor || ''; if (P.bgWid) P.bgWid.value = l.bgWidth || 20;
        if (P.glHas) P.glHas.checked = !!l.hasGlow; if (P.glOp) P.glOp.value = (l.glowOpacity != null ? l.glowOpacity : 0.3) * 100;
        if (P.l1C) P.l1C.value = l.color1 || '#fff'; if (P.l1W) P.l1W.value = l.width1 || 2; if (P.l1A) P.l1A.value = l.animType1 || 'none'; if (P.l1S) P.l1S.value = l.speed1 !== undefined ? l.speed1 : 50;
        let l1sm = gP('prop-l1-speed-mode'); if (l1sm) l1sm.value = l.l1SpeedMode || 'abs';
        gP('prop-l1-rev').checked = !!l.l1Reverse; gP('prop-l1-shape').value = l.l1Shape || 'drop'; gP('prop-l1-emojis').value = l.l1Emojis || '❤️⭐✨'; gP('prop-l1-size').value = l.l1Size || 1; gP('prop-l1-count').value = l.l1Count || 1;
        if (P.l2C) P.l2C.value = l.color2 || '#fff'; if (P.l2W) P.l2W.value = l.width2 || 2; if (P.l2A) P.l2A.value = l.animType2 || 'none'; if (P.l2S) P.l2S.value = l.speed2 !== undefined ? l.speed2 : 50;
        let l2sm = gP('prop-l2-speed-mode'); if (l2sm) l2sm.value = l.l2SpeedMode || 'abs';
        gP('prop-l2-rev').checked = !!l.l2Reverse; gP('prop-l2-shape').value = l.l2Shape || 'drop'; gP('prop-l2-emojis').value = l.l2Emojis || '❤️⭐✨'; gP('prop-l2-size').value = l.l2Size || 1; gP('prop-l2-count').value = l.l2Count || 1;
        let ll2 = gP('link-layer-2'); if (ll2) ll2.style.display = l.lineMode === 'double' ? 'block' : 'none';
        let wg = gP('wrap-gap'); if (wg) wg.style.display = l.lineMode === 'double' ? 'flex' : 'none';
        let wbp = gP('wrap-bg-props'); if (wbp) wbp.style.display = l.hasBg ? 'block' : 'none';
        let wgp = gP('wrap-glow-props'); if (wgp) wgp.style.display = l.hasGlow ? 'flex' : 'none';
        renderLP(l);
    }
}

// Universal update
function U(key, value, fin) {
    if (key.startsWith('global.')) {
        let k = key.split('.')[1]; state.globalAnimConfig[k] = value;
        if (k === 'mode') { uVBM(value, gP('wrap-global-shape'), gP('wrap-global-emojis'), gP('wrap-global-sliders')); let q = document.getElementById('quick-global-mode'); if (q) q.value = value; }
        if (k === 'ecoMode') { if (value) document.body.classList.add('eco-mode'); else document.body.classList.remove('eco-mode'); }
        queueRender(); if (fin) saveState(); return;
    }
    if (!selectedEntity) return; let target = null;
    if (selectedEntity.type === 'main') target = state.bubbles[selectedEntity.id];
    else if (selectedEntity.type === 'mini') target = state.minis[selectedEntity.id];
    else if (selectedEntity.type === 'link') target = state.links[selectedEntity.id];
    if (target && typeof target === 'object') {
        target[key] = value;
        if (selectedEntity.type === 'main') {
            if (key === 'shape') {
                let isC = value === 'circle';
                if (P.szGrp) P.szGrp.style.display = isC ? '' : 'none';
                if (P.whGrp) P.whGrp.style.display = isC ? 'none' : '';
                if (!isC && !target.width)  { target.width  = target.size; if (P.width)  P.width.value  = target.width; }
                if (!isC && !target.height) { target.height = target.size; if (P.height) P.height.value = target.height; }
            }
            if (key === 'size' && target.shape === 'circle') {
                target.width = value; target.height = value;
            }
        }
        if (selectedEntity.type === 'link') {
            if (key === 'useGlobalAnim' || key === 'animType1') uLUI(1, target.animType1 || 'none', target.useGlobalAnim !== false);
            if (key === 'useGlobalAnim' || key === 'animType2') uLUI(2, target.animType2 || 'none', target.useGlobalAnim !== false);
            if (key === 'lineMode') { let ll2 = gP('link-layer-2'); if (ll2) ll2.style.display = value === 'double' ? 'block' : 'none'; let wg = gP('wrap-gap'); if (wg) wg.style.display = value === 'double' ? 'flex' : 'none'; }
            if (key === 'hasBg') { let wbp = gP('wrap-bg-props'); if (wbp) wbp.style.display = value ? 'block' : 'none'; }
            if (key === 'hasGlow') { let wgp = gP('wrap-glow-props'); if (wgp) wgp.style.display = value ? 'flex' : 'none'; }
        }
    }
    queueRender(); if (fin) saveState();
}

const bI = (el, key, parser = v => v) => { if (!el) return; el.addEventListener('input', e => U(key, parser(e.target.value))); el.addEventListener('change', e => U(key, parser(e.target.value), true)); };
const bC = (el, key) => { if (!el) return; el.addEventListener('change', e => U(key, e.target.checked, true)); };

// Global binds
bI(gP('prop-global-mode'), 'global.mode'); bI(gP('prop-global-shape'), 'global.shape'); bI(gP('prop-global-emojis'), 'global.emojis');
bI(gP('prop-global-size'), 'global.size', parseFloat); bI(gP('prop-global-count'), 'global.count', parseFloat); bI(gP('prop-global-wobble'), 'global.wobble', parseFloat);
bC(gP('prop-global-hidelines'), 'global.hideLines'); bC(gP('prop-global-eco'), 'global.ecoMode');

let qgm = document.getElementById('quick-global-mode');
if (qgm) { qgm.value = state.globalAnimConfig.mode || 'pixi_dash'; qgm.onchange = e => { state.globalAnimConfig.mode = e.target.value; if (!selectedEntity) selectEntity(null, null); queueRender(); saveState(); }; }

// Mini-bubble binds
bI(P.miniShape, 'shape'); bI(P.miniRadius, 'borderRadius', parseInt);
bI(P.miniW, 'w', parseInt); bI(P.miniH, 'h', parseInt);
// Link prop binds
bC(P.lUG, 'useGlobalAnim'); bC(gP('prop-link-hidelines'), 'hideLines');
bI(P.name, 'name');
bI(P.shape, 'shape');
bI(P.size, 'size', parseInt);
bI(P.width, 'width', parseInt);
bI(P.height, 'height', parseInt);
bI(P.bg, 'bgColor'); bI(P.border, 'borderColor'); bI(P.glow, 'glowColor');
bI(P.lType, 'type'); bI(P.lMode, 'lineMode'); bI(P.gap, 'gap', parseInt);
bC(P.bgHas, 'hasBg'); bI(P.bgCol, 'bgColor'); bI(P.bgWid, 'bgWidth', parseInt);
bC(P.glHas, 'hasGlow'); bI(P.glOp, 'glowOpacity', v => parseInt(v) / 100);
bI(P.l1C, 'color1'); bI(P.l1W, 'width1', parseInt); bI(P.l1A, 'animType1'); bI(P.l1S, 'speed1', parseFloat); bI(gP('prop-l1-speed-mode'), 'l1SpeedMode');
bC(gP('prop-l1-rev'), 'l1Reverse'); bI(gP('prop-l1-shape'), 'l1Shape'); bI(gP('prop-l1-emojis'), 'l1Emojis'); bI(gP('prop-l1-size'), 'l1Size', parseFloat); bI(gP('prop-l1-count'), 'l1Count', parseFloat);
bI(P.l2C, 'color2'); bI(P.l2W, 'width2', parseInt); bI(P.l2A, 'animType2'); bI(P.l2S, 'speed2', parseFloat); bI(gP('prop-l2-speed-mode'), 'l2SpeedMode');
bC(gP('prop-l2-rev'), 'l2Reverse'); bI(gP('prop-l2-shape'), 'l2Shape'); bI(gP('prop-l2-emojis'), 'l2Emojis'); bI(gP('prop-l2-size'), 'l2Size', parseFloat); bI(gP('prop-l2-count'), 'l2Count', parseFloat);

let bgPicker = gP('prop-bg-color-picker');
if (bgPicker) {
    bgPicker.addEventListener('input', e => {
        let hex = e.target.value;
        let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        let aStr = P.bg.value.match(/rgba?\(.*?,.*?,.*?,(.*?)\)/);
        let a = aStr && aStr[1] ? aStr[1] : '0.1';
        let rgba = `rgba(${r},${g},${b},${a})`;
        P.bg.value = rgba;
        U('bgColor', rgba);
    });
}

// Global settings button
let bgs = document.getElementById('btn-global-settings');
if (bgs) bgs.onclick = e => {
    e.stopPropagation(); let pp = document.getElementById('properties-panel');
    if (!selectedEntity && pp.style.display === 'flex') pp.style.display = 'none';
    else { selectEntity(null, null); pp.style.display = 'flex'; }
};

// Toolbar: Add Main Bubble
let bam = document.getElementById('btn-add-main');
if (bam) bam.onclick = () => {
    let id = 'main_' + generateId(), size = 200, x = innerWidth / 2 - size / 2, y = innerHeight / 2 - size / 2, angle = 0, radius = 0, isFree = false;
    while (!isFree && radius < 2000) {
        isFree = true; let cx = x + size / 2, cy = y + size / 2; for (let bid in state.bubbles) { let b = state.bubbles[bid]; if (b && Math.hypot(cx - (b.x + b.size / 2), cy - (b.y + b.size / 2)) < size / 2 + b.size / 2 + 20) { isFree = false; break; } }
        if (!isFree) { angle += 0.5; radius += 20; x = innerWidth / 2 - size / 2 + Math.cos(angle) * radius; y = innerHeight / 2 - size / 2 + Math.sin(angle) * radius; }
    }
    state.bubbles[id] = { id, name: 'Бабл', x, y, size, shape: 'circle', bgColor: 'rgba(255,0,100,0.1)', borderColor: '#ff0066', glowColor: '#ff0066' }; queueRender(); selectEntity('main', id); saveState();
};

// Toolbar: Add Mini Bubble
let bami = document.getElementById('btn-add-mini');
if (bami) bami.onclick = () => {
    if (!selectedEntity || selectedEntity.type !== 'main') return alert('Сначала выделите Главный Бабл'); let id = 'mini_' + generateId(), b = state.bubbles[selectedEntity.id];
    if (b) { state.minis[id] = { id, name: 'Мини', parentId: b.id, x: _bW(b) / 2, y: _bH(b) / 2, bgColor: 'rgba(0,255,200,0.2)', borderColor: '#00ffcc', glowColor: '#00ffcc' }; queueRender(); selectEntity('mini', id); saveState(); }
};

// Toolbar: Delete + Properties panel "Удалить"
function _doDelete() {
    if (!selectedEntity) return;
    if (selectedEntity.type === 'main') { delete state.bubbles[selectedEntity.id]; for (let m in state.minis) if (state.minis[m] && state.minis[m].parentId === selectedEntity.id) delete state.minis[m]; for (let p in state.points) if (state.points[p] && state.points[p].attachedTo === selectedEntity.id) { state.points[p].attachedTo = null; state.points[p].x = state.points[p]._renderedX || 0; state.points[p].y = state.points[p]._renderedY || 0; } }
    if (selectedEntity.type === 'mini') { delete state.minis[selectedEntity.id]; for (let p in state.points) if (state.points[p] && state.points[p].attachedTo === selectedEntity.id) { state.points[p].attachedTo = null; state.points[p].x = state.points[p]._renderedX || 0; state.points[p].y = state.points[p]._renderedY || 0; } }
    selectEntity(null, null); queueRender(); saveState();
}
let _bde = document.getElementById('btn-del-entity');
if (_bde) _bde.onclick = _doDelete;
let bd = document.getElementById('btn-delete');
if (bd) bd.onclick = _doDelete;

// Toolbar: Delete Link
let bdl = document.getElementById('btn-delete-link');
if (bdl) bdl.onclick = () => { if (!selectedEntity) return; if (selectedEntity.type === 'link') delete state.links[selectedEntity.id]; selectEntity(null, null); saveState(); };

// Toolbar: Copy
let bc = document.getElementById('btn-copy');
if (bc) bc.onclick = () => {
    if (!selectedEntity) return; let nId = selectedEntity.type + '_' + generateId(), target = selectedEntity.type === 'main' ? state.bubbles : state.minis;
    if (target && target[selectedEntity.id]) { target[nId] = JSON.parse(JSON.stringify(target[selectedEntity.id])); target[nId].id = nId; target[nId].x += 30; target[nId].y += 30; selectEntity(selectedEntity.type, nId); saveState(); }
};

// Toolbar: Save JSON
let bs = document.getElementById('btn-save');
if (bs) bs.onclick = () => {
    selectEntity(null, null); queueRender();

    // Combine everything needed into one snapshot
    let snapshot = {
        state: state,
        camera: { x: worldContainer.x, y: worldContainer.y, scale: worldContainer.scale.x },
        minimap: { visible: minimapVisible, state: minimapState, minimized: minimapMinimized }
    };

    setTimeout(() => {
        let jsonStr = JSON.stringify(snapshot, null, 2);
        let blob = new Blob([jsonStr], { type: 'application/json' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        let d = new Date();
        let fname = `bubble_workspace_${d.getFullYear()}${('0' + (d.getMonth() + 1)).slice(-2)}${('0' + d.getDate()).slice(-2)}.json`;
        a.download = fname;
        a.click();
        URL.revokeObjectURL(a.href);
    }, 100);
};

// Toolbar: Load JSON
let bLoad = document.getElementById('btn-load');
let fLoad = document.getElementById('file-load');
if (bLoad && fLoad) {
    bLoad.onclick = () => fLoad.click();
    fLoad.onchange = (e) => {
        let file = e.target.files[0];
        if (!file) return;
        let reader = new FileReader();
        reader.onload = (evt) => {
            try {
                let snapshot = JSON.parse(evt.target.result);
                if (snapshot.state) {
                    state = snapshot.state;
                    window.APP_STATE = state;

                    // Restore Camera
                    if (snapshot.camera) {
                        worldContainer.x = snapshot.camera.x;
                        worldContainer.y = snapshot.camera.y;
                        worldContainer.scale.set(snapshot.camera.scale);
                    }

                    // Restore Minimap
                    if (snapshot.minimap) {
                        minimapVisible = snapshot.minimap.visible;
                        minimapState = snapshot.minimap.state;
                        minimapMinimized = snapshot.minimap.minimized;
                        if (minimapHud) minimapHud.style.display = minimapVisible ? 'block' : 'none';
                        if (minimapBtn) minimapBtn.onclick(new Event('click')); // Trigger resize update
                        if (minimapMinimize && minimapMinimized) minimapMinimize.onclick(new Event('click')); // Trigger minimized visual
                    }

                    // Set global DOM sync
                    if (state.globalAnimConfig) {
                        gP('prop-global-mode').value = state.globalAnimConfig.mode;
                        gP('prop-global-shape').value = state.globalAnimConfig.shape;
                        gP('prop-global-size').value = state.globalAnimConfig.size;
                        gP('prop-global-count').value = state.globalAnimConfig.count;
                        gP('prop-global-wobble').value = state.globalAnimConfig.wobble;
                        gP('prop-global-emojis').value = state.globalAnimConfig.emojis;
                        gP('prop-global-hidelines').checked = state.globalAnimConfig.hideLines;
                        gP('prop-global-eco').checked = state.globalAnimConfig.ecoMode;
                        if (gP('gp-has-glow')) gP('gp-has-glow').checked = state.globalAnimConfig.hasGlow;

                        uVBM(state.globalAnimConfig.mode, gP('wrap-global-shape'), gP('wrap-global-emojis'), gP('wrap-global-sliders'));
                        if (gP('gp-size')) gP('gp-size').value = state.globalAnimConfig.size;
                        if (gP('gp-count')) gP('gp-count').value = state.globalAnimConfig.count;
                        if (gP('gp-emoji-input')) gP('gp-emoji-input').value = state.globalAnimConfig.emojis;

                        document.querySelectorAll('.gp-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === state.globalAnimConfig.mode));
                        document.querySelectorAll('.gp-shape-btn').forEach(b => b.classList.toggle('active', b.dataset.shape === state.globalAnimConfig.shape));
                        let glblLbl = document.getElementById('gp-label');
                        if (glblLbl) {
                            let modeText = { 'off': 'Выкл', 'pixi_dash': 'Пунктир', 'dots': 'Точки', 'pixi_symbols': 'Эмодзи', 'pixi_shapes': 'Фигуры', 'pixi_energy': 'Энергия' };
                            glblLbl.innerText = modeText[state.globalAnimConfig.mode] || 'Вкл';
                        }
                    }

                    // Clear references
                    selectEntity(null, null);
                    partSys = {}; // Clear old particles
                    partSys = {}; // Clear old particles
                    saveState();
                    queueRender();
                }
            } catch (err) {
                alert('Ошибка загрузки JSON: ' + err.message);
            }
        };
        reader.readAsText(file);
        fLoad.value = ''; // Reset input
    };
}

// Init
selectEntity(null, null);

// Minimap Logic
const minimapCanvas = document.getElementById('minimap-canvas');
const minimapCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
const minimapHud = document.getElementById('minimap-hud');
const minimapBtn = document.getElementById('minimap-resize');
const minimapDrag = document.getElementById('minimap-drag');
const minimapMinimize = document.getElementById('minimap-minimize');
const minimapClose = document.getElementById('minimap-close');
const btnToggleMinimap = document.getElementById('btn-toggle-minimap');

let minimapState = 1; // 1 = small, 2 = mid, 3 = max
let minimapVisible = true;
let minimapMinimized = false;

function clampMinimapHud() {
    let mw = minimapHud.offsetWidth;
    let mh = minimapHud.offsetHeight;
    if (minimapHud.style.left && minimapHud.style.left !== 'auto') {
        let maxL = window.innerWidth - mw - 20;
        let l = parseFloat(minimapHud.style.left);
        if (l > maxL) minimapHud.style.left = Math.max(20, maxL) + 'px';
    }
    if (minimapHud.style.top && minimapHud.style.top !== 'auto') {
        let maxT = window.innerHeight - mh - 20;
        let t = parseFloat(minimapHud.style.top);
        if (t > maxT) minimapHud.style.top = Math.max(20, maxT) + 'px';
    }
}

// Toolbar Toggle
if (btnToggleMinimap) {
    btnToggleMinimap.onclick = () => {
        minimapVisible = !minimapVisible;
        minimapHud.style.display = minimapVisible ? 'block' : 'none';
    };
}

// HUD Controls
if (minimapBtn) {
    minimapBtn.onclick = (e) => {
        e.stopPropagation();
        if (minimapMinimized) minimapMinimized = false; // Expanding from minimized restores size

        minimapState = minimapState >= 3 ? 1 : minimapState + 1; // Cycle 1 -> 2 -> 3 -> 1

        minimapHud.style.display = 'block';
        if (minimapState === 1) { minimapHud.style.width = '150px'; minimapHud.style.height = '150px'; }
        if (minimapState === 2) { minimapHud.style.width = '300px'; minimapHud.style.height = '300px'; }
        if (minimapState === 3) { minimapHud.style.width = '80vw'; minimapHud.style.height = '80vh'; }
        setTimeout(() => {
            clampMinimapHud();
            let rect = minimapHud.getBoundingClientRect();
            minimapCanvas.width = rect.width;
            minimapCanvas.height = rect.height;
            queueRender();
        }, 350);
    };
}

if (minimapMinimize) {
    minimapMinimize.onclick = (e) => {
        e.stopPropagation();
        minimapMinimized = !minimapMinimized;
        if (minimapMinimized) {
            minimapHud.style.width = '30px';
            minimapHud.style.height = '30px';
            if (minimapDrag) minimapDrag.style.display = 'none';
            if (minimapBtn) minimapBtn.style.display = 'none';
            if (minimapClose) minimapClose.style.display = 'none';
        } else {
            if (minimapDrag) minimapDrag.style.display = '';
            if (minimapBtn) minimapBtn.style.display = '';
            if (minimapClose) minimapClose.style.display = '';
            if (minimapState === 1) { minimapHud.style.width = '150px'; minimapHud.style.height = '150px'; }
            if (minimapState === 2) { minimapHud.style.width = '300px'; minimapHud.style.height = '300px'; }
            if (minimapState === 3) { minimapHud.style.width = '80vw'; minimapHud.style.height = '80vh'; }
        }
        setTimeout(() => {
            clampMinimapHud();
            let rect = minimapHud.getBoundingClientRect();
            minimapCanvas.width = rect.width;
            minimapCanvas.height = rect.height;
            queueRender();
        }, 350);
    }
}

if (minimapClose) {
    minimapClose.onclick = (e) => {
        e.stopPropagation();
        minimapVisible = false;
        minimapHud.style.display = 'none';
    }
}

let minimapDragging = false;
let hudDragging = false;
let hudDragStartX = 0, hudDragStartY = 0, hudStartLeft = 0, hudStartTop = 0;

if (minimapDrag) {
    minimapDrag.addEventListener('mousedown', e => {
        e.stopPropagation();
        hudDragging = true;
        hudDragStartX = e.clientX; hudDragStartY = e.clientY;
        let rect = minimapHud.getBoundingClientRect();
        hudStartLeft = rect.left; hudStartTop = rect.top;
        minimapHud.style.right = 'auto'; minimapHud.style.bottom = 'auto'; // release anchors
    });
}

if (minimapCanvas) {
    minimapCanvas.addEventListener('mousedown', e => {
        if (minimapMinimized) return; // Cannot map navigate if minimized
        if (e.shiftKey || e.button === 2) { // Shift+drag or right click to move the HUD itself
            hudDragging = true;
            hudDragStartX = e.clientX; hudDragStartY = e.clientY;
            let rect = minimapHud.getBoundingClientRect();
            hudStartLeft = rect.left; hudStartTop = rect.top;
            minimapHud.style.right = 'auto'; minimapHud.style.bottom = 'auto'; // release anchors
        } else {
            minimapDragging = true; navigateMinimap(e);
        }
    });
    window.addEventListener('mousemove', e => {
        if (hudDragging) {
            let nx = hudStartLeft + (e.clientX - hudDragStartX);
            let ny = hudStartTop + (e.clientY - hudDragStartY);
            // bounds clamping
            let mw = minimapHud.offsetWidth;
            let mh = minimapHud.offsetHeight;
            nx = Math.max(0, Math.min(nx, window.innerWidth - mw));
            ny = Math.max(0, Math.min(ny, window.innerHeight - mh));

            minimapHud.style.left = nx + 'px';
            minimapHud.style.top = ny + 'px';
        } else if (minimapDragging) {
            navigateMinimap(e);
        }
    });
    window.addEventListener('mouseup', () => { minimapDragging = false; hudDragging = false; });
    minimapCanvas.addEventListener('contextmenu', e => e.preventDefault());
}

function navigateMinimap(e) {
    if (!minimapData) return;
    let rect = minimapCanvas.getBoundingClientRect();
    let mx = e.clientX - rect.left;
    let my = e.clientY - rect.top;
    let px = minimapData.minX + (mx / rect.width) * minimapData.w;
    let py = minimapData.minY + (my / rect.height) * minimapData.h;

    // Set camera center to this point
    worldContainer.x = -px * worldContainer.scale.x + innerWidth / 2;
    worldContainer.y = -py * worldContainer.scale.y + innerHeight / 2;
    queueRender();
}

let minimapData = null;
function renderMinimap() {
    if (!minimapCtx || minimapState === 0) return;
    let w = minimapCanvas.width, h = minimapCanvas.height;
    minimapCtx.clearRect(0, 0, w, h);

    // Find bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasBubbles = false;
    for (let id in state.bubbles) {
        let b = state.bubbles[id]; if (!b) continue;
        hasBubbles = true;
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + _bW(b)); maxY = Math.max(maxY, b.y + _bH(b));
    }
    for (let id in state.points) {
        let p = state.points[id]; if (!p) continue;
        if (!p.attachedTo) {
            let px = p.x || 0, py = p.y || 0;
            if (px !== 0 || py !== 0) {
                hasBubbles = true;
                minX = Math.min(minX, px); minY = Math.min(minY, py);
                maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
            }
        }
    }

    // Add margin
    if (!hasBubbles) { minX = 0; minY = 0; maxX = innerWidth; maxY = innerHeight; }
    let padX = (maxX - minX) * 0.2 || 500;
    let padY = (maxY - minY) * 0.2 || 500;
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;

    let bw = maxX - minX, bh = maxY - minY;
    minimapData = { minX, minY, w: bw, h: bh };

    // Draw Bubbles
    minimapCtx.fillStyle = 'rgba(255,0,100,0.5)';
    for (let id in state.bubbles) {
        let b = state.bubbles[id]; if (!b) continue;
        let bbw = _bW(b), bbh = _bH(b);
        let nx = ((b.x - minX) / bw) * w, ny = ((b.y - minY) / bh) * h;
        let nw = (bbw / bw) * w, nh = (bbh / bh) * h;
        if (b.shape === 'circle') {
            minimapCtx.beginPath();
            minimapCtx.arc(nx + nw / 2, ny + nh / 2, nw / 2, 0, Math.PI * 2);
            minimapCtx.fill();
        } else {
            minimapCtx.fillRect(nx, ny, Math.max(2, nw), Math.max(2, nh));
        }
    }

    // Draw Screen Rect
    let sc = worldContainer.scale.x;
    let sX = -worldContainer.x / sc;
    let sY = -worldContainer.y / sc;
    let sW = innerWidth / sc;
    let sH = innerHeight / sc;

    let nsX = ((sX - minX) / bw) * w;
    let nsY = ((sY - minY) / bh) * h;
    let nsW = (sW / bw) * w;
    let nsH = (sH / bh) * h;

    minimapCtx.strokeStyle = 'rgba(255,255,255,0.8)';
    minimapCtx.lineWidth = 2;
    minimapCtx.strokeRect(nsX, nsY, nsW, nsH);
    minimapCtx.fillStyle = 'rgba(255,255,255,0.1)';
    minimapCtx.fillRect(nsX, nsY, nsW, nsH);
}

// Hotkey M for Minimap Toggle
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    let k = e.key.toLowerCase();
    if (e.code === 'KeyM' || k === 'm' || k === 'м' || k === 'ь') {
        if (!minimapVisible) {
            minimapVisible = true;
            minimapState = 1;
            minimapHud.style.display = 'block';
            minimapHud.style.width = '150px'; minimapHud.style.height = '150px';
        } else {
            if (minimapState !== 3) {
                minimapState = 3;
                minimapHud.style.width = '80vw'; minimapHud.style.height = '80vh';
            } else {
                minimapVisible = false;
                minimapHud.style.display = 'none';
            }
        }
        if (minimapMinimized && minimapVisible) {
            minimapMinimized = false;
            if (minimapDrag) minimapDrag.style.display = '';
            if (minimapBtn) minimapBtn.style.display = '';
            if (minimapClose) minimapClose.style.display = '';
        }
        setTimeout(() => {
            clampMinimapHud();
            let rect = minimapHud.getBoundingClientRect();
            minimapCanvas.width = rect.width;
            minimapCanvas.height = rect.height;
            queueRender();
        }, 350);
    }
});

queueRender();
