# Vault Router

> Put every note where it belongs with simple local rules — no AI, no cloud, no manual drag-and-drop.

Vault Router keeps your vault tidy by doing one job completely: decide where a note belongs, then move it there fast. It does three things:

- **Route** — move the current note to its rule-matched home.
- **Preview** — see exactly where a note will land before it moves.
- **Sweep** — route every matching note in your Inbox in one pass.

<!-- SCREENSHOT SLOT — drop a real capture here to lift conversions.
     ![Preview route: the destination folder and the rule that matched, before anything moves](docs/assets/hero.png)
     Suggested shot: the "Preview route" result showing destination + matched rule, or an Inbox sweep summary. Save as docs/assets/hero.png -->


Rules match on title, path, tags, and frontmatter — all evaluated locally. Free is useful on day one. Pro lifts every limit and files new notes for you — a **$12 one-time, offline-verified** unlock: [Unlock Vault Router Pro](https://buymeacoffee.com/vaultspotlight/e/554745) (or see the Free vs Pro table below).

## Route

*Send the current note to the right folder.*

- **Local rule matching (Free)** — match on *title starts with*, *path includes*, *required tag*, and a *frontmatter property* (either just exists, or equals a value). All filled conditions must match.
- **First matching rule wins (Free)** — order your rules; the first one that matches decides the destination. Reorder any time.
- **Destination templates (Free)** — build folders from the note itself with `{{frontmatter:key}}`, `{{basename}}`, `{{filename}}`, and `{{ext}}` — e.g. `Meetings/{{frontmatter:project}}`.
- **Up to 5 active rules (Free)** — **Pro is unlimited.** Disabled rules never count against the free limit.

## Preview

*Know where a note goes before it moves.*

- **Preview route (Free)** — run *Preview route for current note* to see the destination and which rule matched — a dry run that moves nothing.

## Sweep

*Route your Inbox backlog in one pass.*

- **Manual Inbox sweep (Free)** — run *Sweep inbox* to route every matching note in your Inbox folder. Free moves up to **25 notes per run**; **Pro is unlimited.**

## Auto-route (Pro)

*New notes file themselves.*

- **Auto-route new notes (Pro)** — new notes file themselves, so you stop dragging notes out of your Inbox. Routing waits until a note's metadata (frontmatter and tags) has been indexed, so property-aware rules land it in the right place.
- **Inbox-only by default (Pro)** — auto-routing is scoped to your Inbox out of the box, so notes you create elsewhere stay put while you work.

## Free vs Pro

**Pro ($12 one-time)** turns manual, capped routing into hands-off, unlimited automation. Basic routing stays free forever.

| Area | Free | Pro |
| --- | :--: | :--: |
| Route the current note | Yes | Yes |
| Preview a route (dry run) | Yes | Yes |
| Rule matching by title, path, tag, property | Yes | Yes |
| Destination templates (`{{frontmatter:project}}`, …) | Yes | Yes |
| Manual Inbox sweep | Up to 25 moves/run | Unlimited |
| Active rules | Up to 5 | Unlimited |
| Auto-route newly created notes | No | Yes |

Purchase: [Buy Me a Coffee — Vault Router Pro](https://buymeacoffee.com/vaultspotlight/e/554745). License keys are verified **offline** (Ed25519) — no account, server, or subscription.

## Destination examples

Combine literal folders with placeholders (`{{frontmatter:key}}`, `{{basename}}`, `{{filename}}`, `{{ext}}`) to build the target path:

- `Meetings/{{frontmatter:project}}`
- `Areas/School/{{frontmatter:course}}`
- `Projects/{{frontmatter:project}}/Notes`

## Commands

- `Vault Router: Route current note`
- `Vault Router: Preview route for current note`
- `Vault Router: Sweep inbox`

## Suggested starter rules

1. **Daily note** — title starts with `Daily -` → `Journal/Daily`
2. **Meeting notes** — tag `meeting` → `Meetings/{{frontmatter:project}}`
3. **Project notes** — property `project` equals `alpha` → `Projects/Alpha`

## Privacy & data

Vault Router is local-first and never phones home.

- No network calls, no cloud sync, no account.
- Pro validation is fully offline.
- All state lives in the plugin's local `data.json` (your rules and settings). Add `.obsidian/plugins/vault-router/data.json` to `.gitignore` if you commit your `.obsidian` folder.

## Install

**Manual:** copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/vault-router/`, then enable **Vault Router** in Settings → Community plugins.

**Community directory:** search **Vault Router** in Settings → Community plugins.

## Activate Pro

1. [Unlock Vault Router Pro](https://buymeacoffee.com/vaultspotlight/e/554745).
2. Your license key is emailed to you **automatically, within seconds** — delivery is fully automated, no waiting.
3. Obsidian → Settings → Vault Router → paste the key. Pro unlocks immediately (offline verification).

## Feedback and support

Bug reports, feature requests, and questions all go to the GitHub issue tracker. It is
the only place I track them, so an issue will always get further than a review comment.

- **[Report a bug](https://github.com/israerusan/vault-router/issues/new?labels=bug)** — please include your Obsidian version, your operating system, and the steps that reproduce it.
- **[Request a feature](https://github.com/israerusan/vault-router/issues/new?labels=enhancement)** — describe the workflow you are trying to make faster; that is more useful than a proposed solution.
- **[Browse open issues](https://github.com/israerusan/vault-router/issues)** — worth a look first, in case it is already tracked.

## More plugins by the same author

Small, local-first Obsidian plugins that each do one job and keep your data in your vault.
All of them are in the community directory — search the name under
**Settings → Community plugins**.

**Search and views**

- [Vault Spotlight](https://github.com/israerusan/obsidian-vault-spotlight) — keyboard-first command center — fuzzy search, saved workflows, and result actions.
- [Bases Power Pack](https://github.com/israerusan/bases-power-pack) — kanban, calendar, Gantt, and outline views over your notes or a `.base` file.

**Vault health**

- [Vault Triage](https://github.com/israerusan/vault-triage) — find stale, orphaned, unfinished, and metadata-broken notes, then work through them.
- [Attachment Audit](https://github.com/israerusan/attachment-audit) — find orphaned, duplicate, oversized, and misplaced attachments, then clean them up safely.
- [Patina](https://github.com/israerusan/patina) — score every note's staleness from edits, opens, and inbound links.
- [FlowKit Health Dashboard](https://github.com/israerusan/flowkit-health-dashboard) — find which add-on is breaking your vault, and score every one installed.

**Writing and research**

- [Prose Lens](https://github.com/israerusan/prose-lens) — live writing feedback — passive voice, adverbs, hedges, cliches, and a reading grade.
- [Prior Art](https://github.com/israerusan/prior-art) — show similar existing notes while you write, and merge duplicates without losing links.
- [Standing Questions](https://github.com/israerusan/standing-questions) — track the open questions in your vault and surface new notes that may answer them.
- [Unwritten](https://github.com/israerusan/unwritten) — report the notes you never wrote — unexplained link pairs, stub hubs, unreasoned decisions.
- [Effort Index](https://github.com/israerusan/effort-index) — measure the editing time behind every note and resurface the expensive ones.

**Time and billing**

- [Task Calendar Bridge](https://github.com/israerusan/obsidian-task-calendar-bridge) — export dated Markdown tasks to standards-based ICS calendar files.
- [Invoice Forge](https://github.com/israerusan/obsidian-invoice-forge) — turn `#billable` notes into numbered invoices, so nothing is missed or billed twice.
- [Time Tracker and Invoicing](https://github.com/israerusan/time-tracker-invoicing) — track billable time against notes and projects, then invoice by client.

## Development

```bash
npm install
npm run build
npm test        # typecheck + lint + full test suite
```

Listed as **Optional payments** in the Obsidian Community directory (free core + paid Pro unlock).
