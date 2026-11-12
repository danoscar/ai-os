# Ideas: what Pixel Office could become

A brainstorm, grouped by what it would do for the person using it. Each idea says how it would work and how big it is
(**S** a day or less, **M** a few days, **L** a week or more). Nothing here is promised; it is a menu.

Already built: live office for Claude Code / Codex / Gemini / Grok, approvals and chat from the office, Second Brain,
Repos, three skins with weather and an RPG layer (permanent plots, Office furnishings), colony map, sector alerts, focus
mode, Insights, Guide with tour, background service, notifications, quick prompts, starting a session from the office, answering questions and denying with a reason, messaging a busy
session, subscription usage bars, jump-to-next-waiting keys, reopening a sleeping session in a terminal.

## 1. A daily cockpit

| Idea | How it would work | Size |
|---|---|---|
| **Morning briefing** | One button: for every project, read the tail of yesterday's transcripts and ask Claude (your subscription) for "what was done, where it stopped, what is waiting on you". Shown as cards and optionally saved as a daily note in the Second Brain. | M |
| **Session handoff notes** | When a session ends, write a short summary note (done / open questions / next step) into a `Sessions/` folder of the vault, linked to the project note. Your notes fill themselves. | M |
| **Approval rules** | "Always allow read-only tools in this project" set from the office, written to that project's Claude settings, with every automatic approval logged. Plus "approve all 3 waiting" in one click. | M |
| **Git on the room door** | Each room shows branch, uncommitted files, ahead/behind, open PR and CI status. A failing CI or a review request becomes a card in the Decision Console. | M |
| **Search everything** | One search box over all transcripts and the vault: "where did I fix the login redirect?" | M |
| **Day replay** | Scrub a timeline of the day and watch the office replay who worked on what. Built on the Insights data. | L |
| **Phone approvals** | A tiny mobile page for approvals only, reachable over Tailscale or the local network, opt-in and protected by a pairing code. | L |
| **Menu-bar companion** | A menu-bar icon with the number of sessions waiting and a dropdown to approve. | L |

## 1b. Borrowed from similar projects

From a comparison with [habblaud](https://github.com/marmottajr/habblaud) and
[bot-crossing](https://github.com/Station-Sciences/bot-crossing) (both MIT). Ideas only; no code or art is copied.

| Idea | Seen in | How it would work here | Size |
|---|---|---|---|
| **"Waiting on a shell" state** | habblaud | A session blocked on a long build or test run gets its own look (hourglass at the desk, cloud over the crop) with a timer and a pass or fail result. | M |
| **Open the session in its own app** | bot-crossing | Sleeping sessions can already be reopened in a terminal. Still open: opening the conversation in the Claude or Codex desktop app, and focusing the terminal of a session that is running. | S |
| **Events read from transcripts** | habblaud | Detect push, PR opened or merged, red CI and releases from the commands sessions already run, with no GitHub token. Feeds "Real events, visible" below. | M |
| **Sectors that stay put** | bot-crossing | A project keeps its place on the colony map between runs, can be dragged, and folds away after a few quiet days. | M |
| **Bigger projects, bigger sectors** | bot-crossing | A project with many sessions gets more tiles; building height follows how much work was done. | M |
| **More tools** | bot-crossing | Readers for OpenCode, Cursor, Antigravity and others, next to Claude Code, Codex, Gemini and Grok. | M each |
| **Session history and search** | habblaud | Browse closed sessions per project and search their text. Overlaps "Search everything" above. | M |

## 2. The world

| Idea | How it would work | Size |
|---|---|---|
| **One continuous world** | Replace "four rooms per page" with one scrolling island where every project owns a plot. Zooming out turns it into the colony map; zooming in shows the desks. This is the big graphics step. | L |
| **Real events, visible** | A rocket launches on `git push`, fireworks on a merged PR, a storm cloud over a session whose tests keep failing, a delivery truck when dependencies install. Driven by tool calls already seen in transcripts. | M |
| **Farm, deeper** | Seasons that follow the real month; the crop type follows the kind of work (tests → wheat, refactors → vines, docs → flowers); animals appear when CI is green; a market stall to spend coins. | M |
| **Space, deeper** | A true honeycomb that grows a new hex per project; a research tree; supply ships whose size follows token use. | M |
| **Office, deeper** | Night shift lighting after dark, a meeting room where a session and its helpers gather, a whiteboard showing the current task, a printer that prints each commit. | M |
| **Characters** | Outfits per AI tool, a pet as a streak reward, emotes (a light bulb on a plan, a rain cloud on errors). | S |
| **Sound** | Optional, quiet chiptune cues: a chime for "needs you", a jingle for a level-up. Off by default. | S |
| **Community skins** | The skin API already exists (`window.SKINS`). Document it and load extra skins from a `skins/` folder. | M |
| **Sharper sprites** | Redraw characters and buildings at twice the pixel density, with walk cycles. | L |

## 3. The game

| Idea | How it would work | Size |
|---|---|---|
| **Quests** | Daily and weekly goals from real behaviour: "answer 5 approvals in under a minute", "ship a PR", "keep a 5-day streak". | M |
| **Coin shop** | Spend harvest coins on decorations you place yourself: fountains, statues, arcade machines. | M |
| **Achievements** | A trophy shelf: first 1M tokens, 100 approvals, 30-day streak, five projects at once. | S |
| **Skill trees** | Each AI tool and each project grows its own tree (Bash, Edit, Search…) from the tools it really uses. | M |
| **Seasons** | A fresh cosmetic theme every few months with its own rewards; progress is kept. | M |

## 4. Teaching new people

| Idea | How it would work | Size |
|---|---|---|
| **Scripted demo** | The no-bridge demo plays a short story (a session starts, asks permission, you approve, crops grow) so a newcomer understands it in 30 seconds. | S |
| **"What is this?" mode** | Hold a key and every part of the screen shows a one-line explanation. | S |
| **Doctor command** | `node doctor.js` prints the same checklist as the Guide tab, for when the page will not load. | S |
| **Sample vault** | A tiny bundled notes folder so the Second Brain tab is not empty on first run. | S |
| **Screenshots and a GIF in the README** | People decide in five seconds; show the three skins and the map. | S |

## 5. Getting it to people

| Idea | How it would work | Size |
|---|---|---|
| **`npx pixel-office`** | Publish to npm so nobody has to clone. `npx pixel-office service install` for the background mode. | S |
| **CI on pull requests** | A GitHub Action that runs `npm test` and syntax checks on every PR, so outside contributions are safe to review. | S |
| **Claude Code plugin** | A `/office` command that starts the bridge and opens the page. | M |
| **Homebrew formula** | `brew install pixel-office`, with `brew services` for the background mode. | M |
| **Update notice** | Opt-in check for a newer release, shown in the Guide checklist. | S |

## Where to start

If the goal is "this helps me every day", the order that pays back fastest:

1. **Git on the room door** with **events read from transcripts**: what needs a commit, a review or a fix, without asking.
2. **"Waiting on a shell" state**: tells a long build apart from a session that is stuck.
3. **Morning briefing** and **handoff notes**: connects the office to the Second Brain.
4. **Real events, visible**: the cheapest way to make the world feel alive.
5. **Sectors that stay put**, then **one continuous world**: the big visual step.
