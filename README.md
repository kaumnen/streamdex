# Streamdex

A local Codex dashboard for Stream Deck+. It shows recent tasks, active goals, token usage, rate limits plus local status. The included profile has two pages plus an animated Codex pet.

## Requirements

- macOS 13 or newer
- Stream Deck+ with Stream Deck 7.1 or newer
- ChatGPT for macOS with Codex set up
- Node.js 24 or newer
- npm

## Install from source

Clone this repo. Run these commands from its folder:

```sh
npm ci
npm run build
npm run validate
npm run link
npm run restart
```

The Streamdex profile installs with the plugin. Select it in Stream Deck if it does not open automatically.

Set `CODEX_BIN` before restarting Stream Deck if the Codex executable is not in `~/.local/bin` or inside the ChatGPT app bundle.

## Development

```sh
npm run check
```

Run `npm run restart` after a rebuild to reload the plugin.

## Data

Streamdex queries only task titles, goal text, token totals, timestamps plus rollout paths from `~/.codex` in read-only mode. Rollout paths are used only to detect live task writers. Account usage plus rate limits come from the local Codex app-server. If that service is unavailable, the dashboard falls back to local token totals.

Task titles plus aggregate metadata stay on the Mac. Streamdex does not read chat bodies or auth tokens.
