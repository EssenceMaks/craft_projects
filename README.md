# CraftSpace — Workspace

Collaborative infinite canvas with GPU-accelerated PixiJS bubbles + inline Component Generator panels.

## Quick Start

Open `workspace.html` (or `index.html`) directly in a browser.
No build step required.

## File Structure

```
CraftSpace/
├── index.html                   — entry point (redirects to workspace.html)
├── workspace.html               — main application shell
├── supabase-config.js           — team credentials & Supabase keys (edit before deploy)
├── supabase-db.sql              — run once in Supabase SQL Editor
│
├── styles/
│   └── workspace.css            — all workspace styles
│
├── engine/
│   ├── pixi-engine.js           — PixiJS 7 bubble/link/particle engine
│   ├── workspace-bridge.js      — PixiJS app capture + theme & background system
│   └── workspace-engine.js      — auth, cloud save/load, live sessions, toast
│
├── panels/
│   └── workspace-cg.js          — world-positioned draggable CG iframe panels
│
├── cg/
│   ├── component-generator.html — Component Generator app (6 tabs, runs in iframes)
│   └── supabase-cloud.js        — cloud integration for standalone CG use
│
└── example/
    └── workspace_snapshot.json  — sample workspace state for testing
```

## Configuration

Edit `supabase-config.js`:
- `SUPA_URL` — your Supabase project URL
- `SUPA_KEY` — your Supabase publishable key
- `TEAM_USERS` — team members with passwords
- `DEFAULT_PROJECT_NAME` — default project name

## Features

- PixiJS GPU canvas with bubbles, mini-bubbles, animated links
- Right-click any bubble → **🧩 Создать окна CG** to spawn Component Generator panels
- Supabase cloud save/load (instances system)
- Live collaboration (broadcast cursors, canvas sync)
- Watch-only and co-edit modes
- Per-user themes and background styles
- Local draft autosave + versioned approved saves
- Minimap, undo/redo, toolbar
