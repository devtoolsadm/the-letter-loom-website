# Letter Loom (Greenfield)

This repository now exposes three entry points:

- `/index.html`: marketing landing with CTAs.
- `/install/`: installation guide + QR code that links to the app.
- `/app/`: the actual PWA (manifest, service worker, and `src/` tree).

The legacy codebase remains under `legacy/` for reference only.

## Active structure inside `/app`

- `app/src/core/`: framework-agnostic logic (wake lock helpers, version file, game logic soon).
- `app/src/i18n/`: language packs and utilities.
- `app/src/styles/`: CSS modules imported by the shell.
- `app/src/ui/`: view controllers and presentation logic (`ui/shell` currently sets up the PWA shell).
- `app/assets/`: icons, videos, and future media consumed by the game.
- `app/manifest.json` + `app/service-worker.js`: PWA plumbing.

## Local development

Run any static server from repo root (e.g. `npx serve .`) and open:

- `http://localhost:PORT/` for the landing.
- `http://localhost:PORT/install/` for the installer page.
- `http://localhost:PORT/app/` for the prototype shell.
