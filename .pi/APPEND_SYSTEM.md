# TENET Pi Session — Behavioral Protocol

## THE RULE: Use tools. Don't narrate using them.

If you're explaining what tool to call instead of calling it — STOP and call it.

---

## Session Start — the steer already loaded your context

The startup briefing (steer message) already provides: recent work, scorecard, dashboard, team activity, hub state, open PRs, and suggested next actions. **Do NOT re-fetch with tool calls.**

**Wait for the user to type, then respond directly.** No startup tool calls.

Call tools only when:
- The user asks for something specific ("show the board" → `tenet_kanban(ls)`)
- You need fresh data mid-session
- You're searching memory for a specific decision

---

## Per Task (every single time)

```
tenet_skill_match("what you want to do")  → finds relevant skills + recipes
tenet_skill_load("skill-name")            → loads it — the skill IS the orchestrator
```

Skills live in the shed (10et-ai/skills). As new skills are published they are 
auto-discovered via `tenet_skill_match` — you never need to know skill names in advance.
Never improvise what a skill should tell you to do — load it first.
Never use gh CLI, bash scripts, or raw git when a Pi tool exists for the job.

---

## Always On (non-negotiable)

| Trigger | Action |
|---------|--------|
| Completed anything significant | `tenet_journal_write` — NOW, not at session end |
| Making any decision | `tenet_memory_search("topic")` first — avoid repeat work |
| Understood WHY something works | `tenet_memory_add` type=`teacup` — the specific thing you were looking at, not the conclusion |
| Filing/working issues | `tenet_kanban` tool — not `gh issue create` directly |
| Every 30 turns or topic switch | `tenet_pivot` — checkpoint so context survives |
| User shares image path | `read` tool immediately — never say "can't read images" |
| Need to know what tools exist | `tenet_capabilities()` — never from memory |
| Need to know what skills exist | `tenet_skill_match("task")` — never from memory |
| Working on multi-issue sprint | `tenet_skill_load("build-agent")` → full spec→eval→PR cycle |

---

## Services — Working Across Repos (never hardcode)

Services are registered in `.tenet/config.json → registered_services`.
Read the registry — never hardcode repo names or paths.

```
tenet_service({ service: "<name>", command: "status" })  → health check
tenet_service({ service: "<name>", command: "logs" })    → recent commits
```

When filing issues or creating PRs for a service, route to its repo:
```
tenet_kanban({ command: "add", args: "fix X --service <name> --label P0,area:infra" })
```

The `--service` flag reads the registry to find the right GitHub repo.
This works for tenet-cli, tenet-platform, tenet-template, and any service 
users register with `tenet onboard` or `tenet service add`.

---

## Kanban Loop

```
tenet_kanban({ command: "ls" })               → see backlog
tenet_kanban({ command: "pick", args: "N" })  → claim issue, move to in-progress
  ... work using Pi tools ...
tenet_kanban({ command: "done", args: "N" })  → close + open PR
```

Labels that exist: P0/P1/P2/P3, agent-ready, area:*, scope:*, tenet/in-progress, tenet/done
For multi-issue sprints: `tenet_skill_load("build-agent")` → spec→eval→agent→PR loop.

---

## Reading Images

When the user sends an image path (screenshot, diagram, photo):
```
read({ path: "/path/to/image.jpg" })
```
Images are sent as attachments and rendered in the TUI. Always read immediately.

---

## What NOT to do

- Don't list tools from memory — call `tenet_capabilities()`
- Don't list skills from memory — call `tenet_skill_match()`  
- Don't use `gh issue create` directly — use `tenet_kanban`
- Don't hardcode service names — read `.tenet/config.json`
- Don't commit directly to main — issues get branches, PRs go through trust gate
- Don't skip journaling — 8-16 entries per session minimum
- Don't plan for 5 messages then not execute — 1 plan, then go
- Don't say "can't read images" — use the `read` tool on the path
