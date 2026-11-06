# The RPG layer: how things level up, and what you get

Everything you do with your AI sessions earns XP. Three things level up independently, and the world visibly grows with them.

| Thing | What it is | Levels with | Shows up as |
|---|---|---|---|
| **Company** | everything together | all XP | the `★ LV` button; unlocks **perks** for the current skin |
| **Land** | one per project (a room / sector) | XP earned in that project | more plots to plant, higher crop/module tiers |
| **Character** | one per session (a desk) | XP that session earned | a title, `Lv` on the nameplate, small cosmetic perks |

Progress is saved on your computer only (`~/.pixel-office/rpg.json`), never in this repository. Click `★ LV` to see perks, XP sources, lands and characters.

## How to level up (XP sources)

| Source | XP |
|---|---|
| a tool call | +1 |
| a finished turn (working → idle) | +8 |
| every 2,000 tokens processed | +1 |
| a permission answered from the office | +3 |
| first activity of a day | +20, plus +5 per streak day (max 10) |
| a harvest / shipped module | 12 + 4 per tier (half of it also goes to the company) |

Levels follow `xp = scale × (level − 1)²` (company 60, land 40, character 40): level 2 at 60 XP, 5 at 960, 10 at 4,860, 15 at 11,760. A busy day of real work is a few hundred XP, so level 5 takes days and level 10 weeks. All the numbers live in `ui/rpg-core.js`.

**Work plants things.** Every 5 *work units* (a tool call is 1, a finished turn is 3) on a project plants one new crop (Farm) or starts one new module (Space) on that project's land. After 15 minutes it is ripe; a few minutes later it is harvested (Farm) or shipped by cargo shuttle (Space), which pays coins and XP and frees the plot for the next one. A land's level caps how many plots can be growing at once (6 + 3 per level, up to 28).

## Perks by skin (company level)

**Office**: L2 extra plants along the walls · L3 coffee machine in every room · L5 neon sign over the hub · L6 an office cat wanders the hallways · L8 gold trim on every desk · L10 party lights over the hallways.

**Farm**: L1 wheat · L2 carrots · L3 well + scarecrow · L4 corn + chickens · L5 windmill + tomatoes · L6 pumpkins + barn · L7 greenhouse (glows at night) + sunflowers · L8 beehives (bees fly) + strawberries · L10 golden apples + fireflies.

**Space**: L1 solar arrays · L2 habitat domes · L3 rover patrols the corridors · L4 antenna masts + drone swarm · L5 science labs · L6 hydroponics bays · L7 fusion reactors · L8 observatories + shuttle pad (launches cargo) · L10 mega-domes + aurora.

**Characters**: L2 name badge · L4 hat band / gold trim · L6 glow ring while working · L8 golden nameplate · L10 legend aura. Titles: Intern, Junior, Associate, Mid-level, Senior, Staff, Lead, Principal, Director, Legend (one per two levels).

## The world

Farm and Space share a day/night cycle (your real clock, or pick Day / Night / a fast cycle) and weather (auto, sunny, cloudy, rain). Rain and meteor showers become more likely when many agents are working at once. These are cosmetic: nothing is lost at night or in a storm.

## Ideas not built yet (pick what feels right)

- **Quests / achievements**: "first harvest", "answer 10 prompts in under a minute", "7-day streak", "ship a module on every project in one day". Badges on the Progress panel.
- **Quality, not just volume**: bonus XP when a turn ends without a permission denial, or when a long task finishes cleanly; small penalty-free "wilting" if a session sits blocked on you for a long time (a gentle nudge to answer approvals).
- **Seasons**: spring/summer/autumn/winter palettes that rotate monthly; seasonal crops.
- **Shop**: spend coins on cosmetics (scarecrow hats, dome colors, desk skins); coins never affect XP, so nothing can be bought into a level.
- **Team mode**: if several people share a bridge, a shared company level with per-person contributions.
- **Skill trees per tool**: Claude / Codex / Gemini / Grok each have a small tree (e.g. "Refactorer", "Reviewer") that gains XP from the kind of tool calls it makes.
- **Prestige**: at level 20 reset the land for a permanent cosmetic star and a faster growth multiplier.
- **Offline growth**: growth already uses real time, so crops keep growing while you are away.

## Honesty about the numbers

XP is derived only from activity the observer really sees (tool calls, turns, tokens, approvals), counted from when the bridge started. Nothing is invented, and there are no daily caps because there is nothing to farm: XP does not buy anything.
