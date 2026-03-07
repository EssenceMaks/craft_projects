// ════════════════════════════════════════════════════════════════
// workspace_ext.js — PixiJS Integration Bridge + Theme/BG System
// Load order: pixi.min.js → workspace_ext.js → bubble_tabs_pixi_engine.js
// Exposes window._pixiApp for dynamic background/theme control.
// ════════════════════════════════════════════════════════════════
'use strict';

// ── Patch PIXI.Application to capture the app instance ──────────
(function patchPixiApp() {
  if (typeof PIXI === 'undefined') {
    console.warn('[workspace_ext] PIXI not loaded — bg color control disabled');
    return;
  }
  const _OrigApp = PIXI.Application;
  function _PatchedApp(opts) {
    const inst = new _OrigApp(opts);
    window._pixiApp = inst;
    return inst;
  }
  _PatchedApp.prototype = _OrigApp.prototype;
  Object.setPrototypeOf(_PatchedApp, _OrigApp);
  PIXI.Application = _PatchedApp;
})();

// ── Theme & Background constants ─────────────────────────────────
window.WS_THEMES = [
  { id: 'void',     label: 'Neon Void',     dot: '#8b5cf6', bg: '#0b0d17' },
  { id: 'cyber',    label: 'Cyber Blue',    dot: '#38bdf8', bg: '#050d1a' },
  { id: 'emerald',  label: 'Emerald Dark',  dot: '#34d399', bg: '#040f0a' },
  { id: 'rose',     label: 'Midnight Rose', dot: '#fb7185', bg: '#120810' },
  { id: 'graphite', label: 'Graphite',      dot: '#aaaaaa', bg: '#0a0a0a' },
  { id: 'amber',    label: 'Amber Dusk',    dot: '#fbbf24', bg: '#120900' },
];

window.WS_BG_STYLES = [
  { id: 'none',    label: '◼ Solid' },
  { id: 'dots',    label: '· · Dots' },
  { id: 'grid',    label: '⊞ Grid' },
  { id: 'circuit', label: '⊛ Circuit' },
  { id: 'nebula',  label: '✦ Nebula' },
];

// ── Apply theme ──────────────────────────────────────────────────
window.applyTheme = function(themeId) {
  const theme = window.WS_THEMES.find(t => t.id === themeId) || window.WS_THEMES[0];
  const html = document.documentElement;
  if (themeId === 'void' || !themeId) {
    html.removeAttribute('data-theme');
  } else {
    html.setAttribute('data-theme', themeId);
  }
  // Update PixiJS background color to match theme
  if (window._pixiApp) {
    const hex = parseInt(theme.bg.replace('#', ''), 16);
    if (window._pixiApp.renderer?.background) {
      window._pixiApp.renderer.background.color = hex;
    } else if (window._pixiApp.renderer) {
      window._pixiApp.renderer.backgroundColor = hex;
    }
    window.queueRender && window.queueRender();
  }
  // Update body background color directly for instant feedback
  document.body.style.background = theme.bg;
  // Persist
  const key = window.SC?.user ? 'ws_theme_' + window.SC.user.id : 'ws_theme_global';
  localStorage.setItem(key, themeId || 'void');
};

window._loadSavedTheme = function() {
  const key = window.SC?.user ? 'ws_theme_' + window.SC.user.id : 'ws_theme_global';
  const saved = localStorage.getItem(key) || 'void';
  window.applyTheme(saved);
};

// ── Apply background style ───────────────────────────────────────
window.applyBgStyle = function(styleId) {
  const body = document.body;
  window.WS_BG_STYLES.forEach(s => body.classList.remove('wsbg-' + s.id));
  if (styleId && styleId !== 'none') body.classList.add('wsbg-' + styleId);
  const key = window.SC?.user ? 'ws_bg_' + window.SC.user.id : 'ws_bg_global';
  localStorage.setItem(key, styleId || 'none');
  // Update bg layer
  const bgLayer = document.getElementById('ws-bg-layer');
  if (bgLayer) bgLayer.className = styleId && styleId !== 'none' ? 'wsbg-' + styleId : '';
};

window._loadSavedBgStyle = function() {
  const key = window.SC?.user ? 'ws_bg_' + window.SC.user.id : 'ws_bg_global';
  const saved = localStorage.getItem(key) || 'none';
  window.applyBgStyle(saved);
};
