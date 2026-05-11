# TENET Workspace

## Runtime: Pi (not Claude Code)

You are running inside **Pi** (`@mariozechner/pi-coding-agent`), not Claude Code.
- Tools are Pi extensions — NOT MCP servers, NOT `.claude/settings.json`
- Skills load from the shed: `tenet_skill_load("name")`
- Build agents run via `tenet build --run <agent>`
- All labels use `tenet/` prefix

## THE RULE: Use tools. Don't narrate using them.

If you're explaining what tool to call instead of calling it — STOP and call it.

## 1. Session Start — do this every time

```
tenet_context()                    → journals, knowledge, project state
tenet_memory_search("topic")       → what did we decide last time?
```

Do both at session start. No exceptions.

## 2. Journal AS you go — not at session end

After EVERY significant action, write an entry. **NOW**, not later.

| Event | Call |
|-------|------|
| Feature completed | `tenet_journal_write({ type: "feature", title: "...", summary: "..." })` |
| Decision made | `tenet_journal_write({ type: "decision", title: "...", summary: "..." })` |
| Bug fixed | `tenet_journal_write({ type: "fix", title: "...", summary: "..." })` |
| Something learned | `tenet_journal_write({ type: "discovery", title: "...", summary: "..." })` |
| Milestone reached | `tenet_journal_write({ type: "milestone", title: "...", summary: "..." })` |

**Target: 8-16 entries/session.** If you've done 3 significant things and written 0 entries — stop and write them NOW.

## 3. Remember — capture insights, search before deciding

```
tenet_memory_search("topic")                                           → find prior decisions first
tenet_memory_add({ title: "...", content: "...", type: "insight" })    → persist what you learned
tenet_memory_add({ title: "...", content: "...", type: "teacup" })     → the door back to an aha moment
```

**Teacup moments**: when you understand WHY something works, capture the specific concrete thing you were looking at — the file, the line, the exact detail. NOT the conclusion. The door back to the insight.

## 4. Issues — file immediately, never ask

```
tenet_file_issue({ title: "...", priority: "P2" })
```

Confirm inline: `Filed #N: <title>` — one line. Keep flowing.

- P0/P1 if urgent. P2 default. Add `labels: "agent-ready"` if a build agent could pick it up.
- Issues always go in **this GTM repo**, even when the fix is in a registered service.
- Cross-repo close: `Closes <org>/<service-repo>#N` in PR description.

## 5. Skills — load when the task needs one

For **deploy, spec, debug, browser, CI, recipes** → load the skill first:
```
tenet_skill_match("what you want to do")   → finds the right skill
tenet_skill_load("skill-name")             → loads it — the skill IS the orchestrator
```

For **journal, memory, issue filing, quick fixes** → just do it directly. No skill load needed.

**Common mappings:**
- Web search / URL → `tenet_skill_load("agent-browser")`
- Writing a spec → `tenet_skill_load("spec")`
- Deploying → `tenet_skill_load("fly-deploy")`

## 6. Checkpoint every ~30 turns

```
tenet_pivot({ summary: "what I was doing" })
```

## Available Tools

- **tenet_file_issue** — file backlog issues (compact, one themed line)
- **tenet_journal_write** — write after every significant action
- **tenet_memory_add** — persist insights (`type: "teacup"` for aha moments)
- **tenet_memory_search** — find past decisions before making new ones
- **tenet_context** — project context, journals, knowledge docs
- **tenet_skill_load** — load a skill before substantial work
- **tenet_skill_match** — find the right skill when unsure
- **tenet_pivot** — checkpoint every ~30 turns
- **tenet_capabilities** — discover all registered tools (source of truth)

## Rules

1. **Journal every significant action** — 8-16 entries/session, explicit params every time
2. **Search memory before deciding** — `tenet_memory_search` first, always
3. **Work off the board** — pick issues, close them
4. **Every code file needs `@purpose` header**
5. **One thing per turn** — complete one logical unit, then stop and check in
