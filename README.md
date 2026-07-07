# Vault Router

> Put every note where it belongs with simple local rules — no AI, no cloud, no manual drag-and-drop.

Vault Router keeps your vault tidy by doing one job completely: decide where a note belongs, then move it there fast. It does three things:

- **Route** — move the current note to its rule-matched home.
- **Preview** — see exactly where a note will land before it moves.
- **Sweep** — clear a pile of inbox notes in one pass.

Rules match on title, path, tags, and frontmatter — all evaluated locally. Free is genuinely useful on day one. Pro adds unlimited rules, unlimited sweeps, and hands-off auto-routing for people who never want to file a note by hand again.

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

*Clear your inbox in one pass.*

- **Manual inbox sweep (Free)** — run *Sweep inbox* to route every matching note in your Inbox folder. Free moves up to **25 notes per run**; **Pro is unlimited.**

## Auto-route (Pro)

*New notes file themselves.*

- **Auto-route new notes (Pro)** — newly created notes are routed automatically once their metadata (frontmatter and tags) has been indexed, so property-aware rules land them in the right place.
- **Inbox-only by default (Pro)** — auto-routing is scoped to your Inbox out of the box, so notes you create elsewhere stay put while you work.

## Free vs Pro

**Pro ($12 one-time)** turns manual, capped routing into hands-off, unlimited automation. Basic routing stays free forever.

| Area | Free | Pro |
| --- | :--: | :--: |
| Route the current note | Yes | Yes |
| Preview a route (dry run) | Yes | Yes |
| Rule matching by title, path, tag, property | Yes | Yes |
| Destination templates (`{{frontmatter:project}}`, …) | Yes | Yes |
| Manual inbox sweep | Up to 25 moves/run | Unlimited |
| Active rules | Up to 5 | Unlimited |
| Auto-route newly created notes | No | Yes |

Purchase: [Unlock Vault Router Pro — $12 one-time](https://buymeacoffee.com/vaultspotlight/e/554745). License keys are verified **offline** (Ed25519) — no account, server, or subscription.

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
2. You'll receive a license key by email.
3. Obsidian → Settings → Vault Router → paste the key. Pro unlocks immediately (offline verification).

## Development

```bash
npm install
npm run build
npm test        # typecheck + lint + full test suite
```

Listed as **Optional payments** in the Obsidian Community directory (free core + paid Pro unlock). Issues and feature requests welcome on GitHub.
