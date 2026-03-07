# CraftSpace — Project Context for AI Assistants

## What this project is

CraftSpace is a self-contained, browser-only collaborative workspace combining:
1. **PixiJS GPU canvas** (`engine/pixi-engine.js`) — infinite canvas with animated bubbles, links, and particles
2. **Component Generator** (`cg/component-generator.html`) — 6-tab UI kit builder, opened as iframe panels inside bubble world-space
3. **Supabase backend** — soft auth (no registration), cloud save/load, realtime live sessions

## File roles

| File | Role |
|------|------|
| `workspace.html` | Main app shell — HTML markup only, no inline CSS/JS |
| `styles/workspace.css` | All workspace styles (dark neon theme, modal styles, cloud-bar) |
| `engine/pixi-engine.js` | PixiJS 7 bubble engine — self-contained, exposes `getBubbleState`, `setBubbleState`, `worldContainer`, `_bubbleSetUser`, `queueRender` |
| `engine/workspace-bridge.js` | Patches `PIXI.Application` to capture `window._pixiApp`; defines `WS_THEMES`, `WS_BG_STYLES`, `applyTheme`, `applyBgStyle` |
| `engine/workspace-engine.js` | Auth (`SC` object, `doLogin`, `showLoginModal`), cloud (`pushToCenter`, `loadInstance`), live sessions (`startLiveSession`, `watchLive`), toast (`wsToast`), notes |
| `panels/workspace-cg.js` | Creates world-positioned draggable/resizable iframe panels for CG; `createCGWindows`, `createCGWorldForBubble`, `restoreCGFromState` |
| `cg/component-generator.html` | Standalone Component Generator app — 6 tabs (UI Kit, Наборы, Сборка, Экспорт, Галерея, Анимации). Loaded via `?tab=N&embed=1` in iframes |
| `cg/supabase-cloud.js` | Cloud integration for standalone CG use (separate from workspace-engine.js) |
| `supabase-config.js` | `SUPA_URL`, `SUPA_KEY`, `TEAM_USERS`, `DEFAULT_PROJECT_NAME` — edit before deploy |
| `supabase-db.sql` | Run once in Supabase SQL Editor to create `projects` and `versions` tables |

## Load order in workspace.html

```
1. pixi.min.js          (CDN)
2. engine/workspace-bridge.js   — patches PIXI before engine loads
3. supabase-js          (CDN)
4. lucide CSS           (CDN)
5. styles/workspace.css
--- body ---
6. supabase-config.js
7. engine/pixi-engine.js        — starts PixiJS immediately
8. engine/workspace-engine.js   — integration layer
9. panels/workspace-cg.js       — CG panel system
10. initWorkspace()             — starts everything
```

## Key globals

- `window.SC` — auth + live session state object (defined in workspace-engine.js)
- `window.worldContainer` — PixiJS Container, camera transform (defined in pixi-engine.js)
- `window.getBubbleState()` / `window.setBubbleState(snap)` — state serialisation
- `window.queueRender()` — request a render frame
- `window._pixiApp` — captured PixiJS Application instance (for background color changes)
- `window.broadcastCanvasUpdate()` — debounced live broadcast of canvas changes
- `window.wsToast(msg, type)` — show toast notification

## CG panel iframe path

Panels load: `cg/component-generator.html?tab=N&embed=1`
The component-generator imports `../supabase-config.js` (one level up).

## Supabase schema

Table `projects`: `id (text PK), name, data (jsonb), owner, live (bool), version_label, created_at, updated_at`

Instance naming: `{projectBase}_экземпляр_{N}`
Live records: `live_{userId}` with `live=true`

## Do NOT

- Add comments or remove existing ones without explicit request
- Rewrite functionality — only reorganize, fix, or extend
- Create files outside CraftSpace directory for this project
- Reference files from parent directories (project must be self-contained)
