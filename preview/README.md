# Letter Loom (Greenfield)

This repository now exposes three entry points (co-hosted for now, but they may live on separate hosts in the future):

- `/landing/index.html`: marketing landing with CTAs. Has its own assets/i18n and must be responsive.
- `/app/`: the actual PWA (manifest, service worker, and `src/` tree).

The legacy codebase remains under `legacy/` for reference only.

## Active structure inside `/app`

- `app/src/core/`: framework-agnostic logic (wake lock helpers, version file, game logic soon).
- `app/src/i18n/`: language packs and utilities.
- `app/src/styles/`: CSS modules imported by the shell.
- `app/src/ui/`: view controllers and presentation logic (`ui/shell` currently sets up the PWA shell).
- `app/assets/`: icons, videos, and future media consumed by the game.
- `app/manifest.json` + `app/service-worker.js`: PWA plumbing.

## Landing page requirements

- Must be responsive (desktop + mobile).
- Keeps its own assets, styles, and i18n; do not reuse code/assets from `/app/`.
- Content sections: game title, CTA to support (Kickstarter/analog), social links (Instagram, TikTok) and contact, help (quick guide, full manual, explanatory video), and the support app section (play online, install here, install via QR on another device).
- Visual style should match the app/legacy brand (colors, fonts, logo) by cloning tokens/resources—not by importing from `/app/`.
- Language switch allowed to refresh the page if that simplifies landing i18n (only for landing).

## Local development

Run any static server from repo root (e.g. `npx serve .`) and open:

- `http://localhost:PORT/landing/` for the landing.
- `http://localhost:PORT/app/` for the prototype shell.
- `http://localhost:PORT/` default, redirect to the landing.
