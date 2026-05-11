<p align="center">
  <img src="https://10et.ai/favicon.svg" width="48" height="48" alt="TENET">
</p>

<h1 align="center">TENET Template</h1>
<p align="center">Starter template for new TENET workspaces. Used by <code>tenet init</code>.</p>

---

## What This Is

This repo is cloned when you run `tenet init -n my-project`. It includes:

- **CLAUDE.md** — Agent instructions, journal protocol, session management
- **Skills** — Brand architect, content creator, search, spec, startup, and more
- **Scripts** — Session init/cleanup, auto-commit, doctor, sync
- **Knowledge templates** — VISION, THESIS, NARRATIVE, ARCHITECTURE, RUNBOOK
- **Config** — `.tenet/config.json`, `.mcp.json`, Claude Code hooks

## Structure

```
├── .tenet/config.json        — Project configuration
├── .mcp.json                 — MCP server config (tenet-context-hub)
├── .claude/settings.json     — Session hooks and journal enforcement
├── CLAUDE.md                 — Agent instructions
├── knowledge/                — Living documents
├── scripts/session/          — Session lifecycle scripts
└── templates/                — Sub-templates (service agents, brand, etc.)
```

## How It Works

1. `tenet init -n my-project` clones this repo
2. Customizes `.tenet/config.json` with project name and owner
3. Result: a fully configured TENET workspace

Existing projects update via `tenet update` (refreshes skills, scripts, CLAUDE.md).

## License

MIT
