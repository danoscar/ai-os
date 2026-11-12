# Pixel Office

A pixel-art isometric "office" that shows your **real Claude Code sessions** as characters at desks, lets you
answer their permission prompts from one place, chat with a session without switching windows, and browse your
notes (an Obsidian vault, graphify output, any folder of markdown) in a "Second Brain" tab.

Zero dependencies (Node 18+), one HTML file for the UI. Everything stays on your computer: the server only listens
on `127.0.0.1`. Tested on macOS; Linux should work; Windows is untested.

```bash
git clone <this repo> && cd pixel-office
node server.js          # then open http://localhost:8787
```

Opening `index.html` directly (no server) gives a simulated demo. New here? Open the **? GUIDE** tab in the app: it has a
live setup checklist, a one-minute tour and the full manual.

To keep it running without a terminal: `node service.js install` (see [Run in the background](#run-in-the-background)).

## What you see (Observe mode, the default)
Same idea as [habblaud](https://github.com/marmottajr/habblaud): nothing is launched, the bridge reads what Claude Code
already writes.

- `~/.claude/sessions/<pid>.json` → which sessions are open and their status (busy / idle / waiting on you)
- `~/.claude/projects/<project>/<session>.jsonl` → current activity, model, context size (only the tail is read; transcripts can be hundreds of MB)
- `…/<session>/subagents/` → active subagents show up as extra desks

Rooms = projects (worktrees fold into their parent project), desks = sessions. Four rooms per page; extra projects get
page buttons (`!` = a session there is waiting for you, `•` = working). Dimmed desks with Zzz are subagents that finished
in the last 30 min and the project's other sessions from the last 24 h that aren't running ("sleeping"). When a room is
full (4 desks) sleepers and finished helpers are bumped first (`+N` in the legend).

**Project selector** (dropdown above the floor): open one project's room, zoomed in, with the console, header and decisions
focused on it. "All projects" returns to the overview. Two folders with the same name get their parent folder added.

Tool calls\* and tokens\* count from when the bridge started. Obvious secrets in commands (Bearer tokens, `sk-…`, `ghp_…`,
passwords in URLs, `KEY=…`) are masked before anything reaches the browser.

## Colony map, sector alerts, focus mode
- **⬡ MAP** (`M`): every project on one screen as hex sectors, drawn in the current skin (office towers, farm fields, space
  domes). Little people show who is working, waiting or asleep; a sector that needs you pulses amber. Click a sector to open
  that project, click HQ to see all of them.
- **Sector alerts**: inside the world, a room with a session waiting on you pulses amber with a NEEDS YOU sign, and a busy
  room shows running lights around its edge. Works in every skin.
- **⛶ Focus** (`F`): hides the console and the log so the world fills the window.
- **🔔 Notifications**: opt-in browser notifications when a session needs you or finishes while the tab is in the background.

## Insights tab
**◔ INSIGHTS** shows where the time went: working time, time sessions spent *waiting on you*, tokens, tool calls and approvals,
by hour, by day (14 days) and by project and AI tool, plus a few plain-language observations. The bridge samples once a second
and keeps 30 days in `~/.pixel-office/stats.json`. It only counts while the bridge runs.

## Run in the background
```bash
node service.js install            # start now and at every login, no terminal needed
node service.js install --notify   # same, plus desktop notifications when a session needs you and no tab is open
node service.js status             # installed? running? where are the logs?
node service.js restart | stop | start | logs | open
node service.js uninstall          # stop it and remove the service
```
A per-user service, no sudo: a LaunchAgent on macOS (`~/Library/LaunchAgents/com.pixeloffice.bridge.plist`), a
`systemd --user` unit on Linux (`~/.config/systemd/user/pixel-office.service`; add `loginctl enable-linger "$USER"` to keep it
running after logout), a logon task on Windows. It restarts on crashes and logs to `~/.pixel-office/logs/bridge.log`.
`--port N` picks another port. The install remembers the `PATH` of the terminal you ran it from (so the service finds
`claude`, `gh`, `glab`); tokens in your environment are never copied into the service file. Tested end to end on macOS;
the Linux and Windows paths are written but not yet tested. Run `install` again after moving the folder or changing Node.

To remove every trace: `node service.js uninstall`, `node install-hook.js --uninstall`, then delete `~/.pixel-office`.

## Skins and the RPG layer
Pick a **skin** in the dropdown above the floor: **Office** (default), **Farm** (every project is a fenced field; work plants crops that grow, ripen and get harvested; farmers instead of office workers; sun, clouds, rain, day and night) or **Space** (hex sectors joined by corridors; sessions are domes with little robots; work builds modules that finish and ship; drifting asteroids, meteor showers). Weather and time of day have their own dropdowns.

Behind the skins is an **RPG layer**: the company, every project ("land") and every session (character) earn XP from real work and level up, which unlocks perks, more plots and higher crop/module tiers. Click `★ LV` for perks, XP sources and progress (and a slider to preview the world at any level); the full design and a list of ideas is in [docs/RPG.md](docs/RPG.md). Progress is saved only in `~/.pixel-office/rpg.json`.

## Repos tab
**⎇ REPOS** lists your GitHub or GitLab repositories (search, sort, private/fork/archived filters, recent commits and open PRs/MRs). Projects open in the office are matched to repos by their git remote and get an **IN OFFICE** badge that jumps to the room. No tokens are stored: the bridge uses the CLI you are already logged into (`gh auth login` / `glab auth login`) or `GITHUB_TOKEN` / `GITLAB_TOKEN` (+ `GITLAB_HOST` for self-hosted) from the environment. Read-only.

## Chat with a session
Click an agent → **Conversation**. You see the session's recent messages (read from its transcript) and can send a new
one. Sending continues that same session with `claude -p --resume <id>` using your Claude subscription login (no API key;
`ANTHROPIC_API_KEY` is removed from the child environment). Notes:
- Works for sessions that are idle or not running. A session that is busy or waiting can't be messaged until it is idle.
- If the session is open in Claude Code/Desktop, you are asked to confirm: the reply is appended to the same conversation,
  but the Claude window may not refresh until reopened.
- If Claude needs a permission mid-reply, an Allow/Deny card appears in the Decision Console and the reply continues once you allow.
- Replies are visible as they are written, because the transcript is the source of truth.

## Quick prompts and new sessions
- **Quick prompts**: saved prompts shown as buttons in every session card ("Continue", "Status", "Run tests"…). One click sends
  it to that session; Alt-click puts it in the box to edit first. **⚡ PROMPT** in the top bar sends one prompt to several
  sessions at once and opens the editor, where a prompt can be for every project or for one. Stored in
  `~/.pixel-office/config.json`.
- **＋ SESSION**: pick a project the office already knows, pick the tool (Claude Code, Codex, Gemini CLI, Grok Build) and an
  optional first prompt; a terminal window opens in that folder with the tool running. Repos that are in the office get the
  same button on the Repos tab. On macOS it opens Terminal (set `PIXEL_OFFICE_TERMINAL=iTerm` or another app to change it);
  on Linux the first terminal program found. Tested on macOS only.
- Safety: only folders where a session has been seen can be opened, the tool comes from a fixed list, and the prompt is
  written to a private temporary script with strict quoting rather than placed on a command line.

## Answer from the office (opt-in hooks)
Everything here is opt-in and installed by one script. A timestamped backup of `settings.json` is written before any change,
and `node install-hook.js --uninstall` removes all of it. `node install-hook.js --status` shows what is on.

```bash
node install-hook.js            # approvals + questions
node install-hook.js --inbox    # also: message a session while it is busy
node install-hook.js --usage    # also: subscription usage bars
node install-hook.js --all      # all three
```

- **Approvals**: a permission prompt becomes a card in the Decision Console with Allow, Always (the rule Claude Code suggests)
  and Deny. Type a line before Deny to tell the session what to do instead. The terminal prompt keeps working; whichever you
  answer first wins.
- **Questions**: when a session asks a multiple-choice question, the card shows every option as a button, plus a free-text
  "Other". "Answer in terminal" leaves it to the terminal. Set `PIXEL_OFFICE_QUESTIONS=0` to keep questions in the terminal.
- **Message a busy session** (`--inbox`): chat and quick prompts no longer need the session to be idle. Your text is written to
  `~/.pixel-office/inbox/` and a small hook hands it to the session after its next tool call, or when its turn ends. With
  nothing waiting, the hook is one file check.
- **Usage bars** (`--usage`): the header shows your 5-hour and weekly subscription limits and when they reset. Claude Code only
  gives these numbers to the status line command, so this wraps yours: it copies the two percentages to
  `~/.pixel-office/usage.json` and then runs your own status line unchanged.
- Fail-safe: if the bridge is not running, no office page is open, or anything goes wrong, every hook steps aside and Claude Code
  behaves as if it were not installed. Nothing is ever approved without a click.

Also in the session card: **▶ OPEN IN TERMINAL** reopens a session that is not running (`claude --resume`).
Keys: `N` jumps to the next session waiting on you, `B` to the busiest one.

## Second Brain tab
Click **◈ SECOND BRAIN** and point it at a folder of notes. Detected Obsidian vaults are offered automatically (read from
Obsidian's own vault list), or browse for any folder / paste a path. It is read-only; the choice is saved only on this computer
in `~/.pixel-office/config.json` (nothing about your vault is in this repository).
- File tree, search, rendered markdown (wikilinks, callouts, tables, tasks, images, frontmatter), backlinks
- **Link graph** built from your `[[wikilinks]]`
- **Graphify** graph if the folder has `graphify-out/graph.json` (colored by community; nodes open their source note) and the `GRAPH_REPORT.md`
- Safety: paths are resolved with `realpath` and must stay inside the folder; symlinks that escape are refused; only `.md` and images are served.

## Spawn mode (optional)
Open `/?mode=spawn` (or click the mode badge) to start new Claude Code tasks from the terminal at the bottom
(`@agent do something`, plan → approve → execute). Agents work inside `workspace/<agent-id>/`.

## Other AIs: Codex, Gemini CLI, Grok (alongside Claude, in parallel)
Sessions from other tools show up in the same rooms (a project folder with a Claude session and a Codex session shares one
room). Their names get a `CX ·` / `GM ·` / `GK ·` prefix and the modal says which tool it is.

| Tool | Reads | Shown | Chat |
|---|---|---|---|
| Claude Code | `~/.claude/sessions` + transcripts | live status, subagents, sleeping sessions, permission prompts | yes |
| Codex CLI / app | `$CODEX_HOME/sessions/…/rollout-*.jsonl` (default `~/.codex`) | activity, model, tokens, conversation | read-only |
| Gemini CLI | `~/.gemini/tmp/<project>/chats/session-*.jsonl` (also the older `.json`; override with `GEMINI_DIR`) | activity, model, tokens, conversation | read-only |
| Grok Build (xAI CLI) | `$GROK_HOME/sessions/…/<session>/{summary.json,updates.jsonl}` (default `~/.grok`) | activity, model, conversation | read-only |
| Grok Bot (desktop app) | only `~/.grokbot/local-exec-daemon.json` (override `GROKBOT_DIR`) | running / idle, tasks in flight | no conversation data |

Codex and Gemini keep no "who is open" registry, so status is inferred: **working** if the session file changed in the last 20 s,
**idle** while that tool's process is running (macOS/Linux, via `ps`), otherwise **sleeping** (shown dimmed, last 24 h).
They cannot raise permission prompts here. **Grok Bot** only exposes its status file: the same folder holds sealed credentials, settings and a log, which are
deliberately never opened. **Grok Build's** on-disk layout is only partly documented (how the working directory is recorded isn't),
so that reader tries several field names and falls back to the folder key. Both readers were written from the tools' documented/open-source formats and are
covered by fixture tests (`npm test`), **not yet verified against a live install**; unknown lines are skipped, so a format
change degrades detail rather than breaking the office.

**ChatGPT in the browser** has no local session files, so it can't be observed without an API key. Adding another CLI means
writing one provider (`providers/*.js`: scan files → `{id, project, name, status, activity, model, tokens}`) and registering
it in `observer.js`.

## Configuration
`PORT` (8787), `CLAUDE_BIN` (path to the `claude` binary), `TOKEN_BUDGET`, `GITHUB_TOKEN` / `GITLAB_TOKEN` / `GITLAB_HOST` (optional, Repos tab), `CLAUDE_CONFIG_DIR` (default: every `~/.claude*` that has a `sessions/` folder), `PIXEL_OFFICE_TERMINAL` (terminal app for ＋ SESSION), `PIXEL_OFFICE_NOTIFY=1` (desktop notifications from the bridge when no tab is open; set by `service.js install --notify`).

Ideas and what could come next: [docs/IDEAS.md](docs/IDEAS.md).

## Security notes
Local only (Host/Origin checks, JSON-only POSTs). The bridge can run `claude` for you and show your notes, so don't expose the
port to a network. `npm test` runs the provider fixture tests. `dev/fake-claude.js` is a stand-in CLI for testing (`CLAUDE_BIN=dev/fake-claude.js node server.js`).
