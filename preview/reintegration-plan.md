# Letter Loom Reintegration Plan

This file tracks the step-by-step process for merging the working minimal PWA test with the original project, ensuring nothing is lost and the new format is clean.

## Minimal Prototype Feature Inventory

- **PWA shell + install context**: `index.html` already wires the manifest, theme color, Apple tags, and icons while exposing a `fromPWA` query flag plus an `isStandaloneApp()` helper to detect if the app was opened from an installed shortcut.
- **Auto-scaling stage**: The CSS `--game-width/height` variables and the `scaleGame()` routine center and scale the `#game-root` container on every `resize`, `orientationchange`, and `DOMContentLoaded` event so the 360x640 layout stretches crisply on any viewport.
- **Portrait lock overlay**: `checkOrientationOverlay()` swaps between `#game-root` and `#orientation-root`, showing the rotate-device overlay for handheld devices while letting desktops continue uninterrupted.
- **Wake Lock manager with fallback**: `#wakeLockBtn` controls `src/wakeLockManager.js`, which prefers the standard `navigator.wakeLock` API but falls back to playing the hidden `#videoWakeLockWorkaround` element when needed so the screen never sleeps mid-session.
- **Touch zoom suppression**: The self-executing `preventMobileZoom()` listener plus `touch-action: none` styling block double-tap and pinch zooms to keep gesture handling predictable for the canvas-style UI.
- **Viewport telemetry**: `updateScreenInfo()` reports install mode, logical game size, device resolution, and current zoom factor into `#screen-info`, simplifying debugging on phones and tablets.
- **Layout stress controls**: Header/footer toggles and the lorem text expander let us validate how the scaled layout behaves when sections are hidden or overflow grows, ensuring the scaling math stays solid.

## Legacy Feature Inventory

- **Game phase + timer engine**: `src/gameController.js` drives the Letter Loom ruleset (setup, strategy, word building, scoring, tie-breakers) with resumable timers, dealer/starter rotation, and win detection that must be preserved.
- **Player roster management**: `src/ui/mainUI.js` manages player slots, color assignment, suggested/default names, shuffle utilities, and per-player state, all persisted through localStorage.
- **Config + modality settings**: The same UI file stores modality (rounds vs points), per-phase timers, score tracking toggles, and the `saveConfig`/`loadConfigSetting` persistence helpers.
- **Name history + localization glue**: Features such as name history, last players, and language-aware default names rely on `TEXTS` in `src/i18n/texts.js` plus translation maps created in `mainUI.js`.
- **Modal framework**: `src/ui/modals.js` and `score-modal.html` provide reusable modals for score input, confirmations, and player customization that must plug back into the new shell.
- **Sound + feedback**: Tone.js-backed sound toggles, urgent/main cues, and UI indicators implemented in `mainUI.js` are part of the player experience and need to survive the merge.
- **Styling + versioning assets**: `src/ui/main.css`, `src/ui/modals.css`, and the CI-populated `src/version.js` drive the legacy look-and-feel and version display, so the new structure has to accommodate them.

## Iterative Integration Principles

- **Always internationalize first**: No new DOM text or string literal should remain hard-coded. Every time we touch a view, we move its copy to `TEXTS` (even if temporarily grouped under a "prototype" namespace) before wiring logic.
- **Separate concerns aggressively**: Keep logic modules (`src/gameController.js`, helpers) free of DOM/CSS, move presentation-specific code into UI modules, and funnel styles into dedicated CSS files rather than inline blocks.
- **Short feedback loops**: Instead of a big-bang merge, we validate each migration slice (logic injection, UI wiring, styling refactor) on devices before starting the next slice.
- **Architecture is flexible**: Use each iteration to decide if folders, build output, or bundling strategy should change; don't assume current structure is final.
- **Lock visual scale**: Typography and layout measurements must use fixed units (px) so the game looks identical regardless of user font/zoom preferences; mobile zoom is disabled at the shell level to preserve layout fidelity.
- **Centralized logging**: All diagnostics (UI, core helpers, service worker) must use `src/core/logger.js` so messages propagate to the in-app log panel and the console uniformly; never call `console.*` directly from feature code.

## Reintegration Steps

1. **Dependency + text audit**: Catalogue how `index.html`, `src/wakeLockManager.js`, and the legacy modules depend on each other, and list every user-facing string that still lives in code; this drives the order of extraction.
2. **Define target folder layout**: Sketch the desired separation (e.g., `/src/core`, `/src/ui`, `/src/styles`, `/src/i18n`), decide where PWA shell code lives, and document migration rules so each iteration pushes toward that goal.
3. **Internationalize the prototype shell**: Move the prototype’s visible text (titles, overlay copy, buttons, tooltips) into `TEXTS`, add temporary lookup helpers, and make sure switching languages already works in the minimal UI.
4. **Extract shell styles**: Relocate inline CSS from `index.html` into a dedicated base stylesheet, keeping only critical layout variables in the HTML; ensure the build loads styles via `<link>` tags to simplify future overrides.
5. **Bridge core logic gradually**: Embed `src/gameController.js` into the new shell behind a thin adapter so we can render minimal UI states while continuing to refactor the rest of the legacy UI.
6. **Port UI modules feature-by-feature**: Bring in `mainUI.js`, `modals.js`, CSS, and HTML fragments one capability at a time (player setup, score modal, timers, etc.), internationalizing and splitting styles as each feature arrives.
7. **Refine persistence + sound hooks**: Once basic UI works in the new shell, reintroduce localStorage flows, Tone.js integration, and wake-lock toggles, making sure their user-facing strings live in `TEXTS`.
8. **Device test after every slice**: Each time we finish integrating a feature (a "slice"), install the PWA on at least one phone/tablet and verify the three critical behaviours-installation flow, portrait lock overlay/orientation handling, and wake-lock toggle-before we continue with the next feature.
9. **Documentation + deployment readiness**: Update README/CONTRIBUTING with the new architecture decisions, revisit build/deploy scripts, and validate the PWA on the intended hosting platform.

## Landing vs App Separation

- Landing (`/index.html`) and App (`/app/`) may be deployed on different hosts. Treat them as separate surfaces with their own assets, styles, and i18n. Do not import code/assets across surfaces; clone brand tokens (colors, fonts, logo) as needed to maintain visual consistency.
- Landing can refresh on language change if that simplifies implementation; the app should switch language without reload.
- Landing content must remain simple, responsive, and cover: game title, support CTA (Kickstarter/analog), social links (Instagram, TikTok) and contact, help (quick guide, full manual, explanatory video), and the support app section (play online, install on this device, install via QR on another device).

## Dependency + Text Audit (Iteration 1)

### Module & Asset Dependencies

- `index.html`: Owns the PWA shell (manifest link, icons, Apple meta tags) and hardcodes the DOM structure that later UI modules must hook into (`#game-root`, `#orientation-overlay`, `#wakeLockBtn`, `#screen-info`, header/footer toggles, lorem stress blocks). Imports `./src/wakeLockManager.js`, consumes `assets/rotate-device-icon.png` and `assets/empty-video.mp4`, and relies on the `fromPWA=1` flag that `manifest.json` injects via `start_url`. The inline script drives wake-lock toggles, zoom prevention, screen info telemetry, and orientation overlay state.
- `manifest.json`: Supplies install metadata (name, description, icons, `start_url`) and enforces portrait orientation. The `start_url` query parameter is read by `index.html` to detect launcher context; any change must stay in sync.
- `service-worker.js`: Manages a single `letter-loom-cache-v3`, forces network-first fetches for `src/version.js`, and notifies `clients` with `{type: 'refresh'}` when the cached version changes. Falls back to cache-first for other same-origin assets under the repo root; expects `src/version.js` to exist for cache-busting.
- `src/version.js`: Exposes `APP_VERSION`, consumed by both the service worker (for cache refreshing) and `src/ui/mainUI.js` (UI footer).
- `src/wakeLockManager.js`: Pure helper that needs DOM references (`videoEl`, `statusEl`) passed in from `index.html`. Depends on `navigator.wakeLock`, `document.visibilityState`, and the hidden `<video>` fallback to simulate wake-lock when the API is unavailable.
- `src/gameController.js`: Self-contained state machine with timers, listeners, and phase management. `src/ui/mainUI.js` depends on its public API (constructor signature, `emitChange`, phase constants, timer helpers). No DOM access today, so it can be moved to `/src/core`.
- `src/i18n/texts.js`: Central dictionary consumed by `mainUI` and `modals`. Provides helper utilities (`interpolate`, `setTextVars`, `clearTextVars`). Any new UI module must import from here rather than embedding literals.
- `src/ui/mainUI.js`: Glues `TEXTS`, `APP_VERSION`, and `GameController` to the DOM. Requires dozens of element IDs (`setup-screen`, `game-screen`, `player-count`, `timer-display`, `lang-toggle-btn`, etc.), assumes Tailwind-like CSS classes defined in `src/ui/main.css`, optionally calls `renderScoreboard()` if globally available, and persists state via `localStorage` keys (`letterloom_*`, `last_players`, `name_history`). Also depends on `showModal`/`showPlayerCustomizationModal` from `src/ui/modals.js` and `window.Tone`.
- `src/ui/modals.js`: Provides a general modal renderer plus the player customization modal. Relies on CSS classes (`modal-overlay`, `game-panel`, `.player-row`, etc.), expects to be handed `TEXTS`, and manipulates the DOM directly (drag-and-drop order, color palette popup). Needs `score-modal.html` structure for the scoreboard modal to exist in DOM when imported.
- `score-modal.html`: Static HTML snippet for the score modal overlay; currently not injected into `index.html`, so any reintegration must explicitly mount/attach it inside the new scaled shell.
- `src/ui/main.css` & `src/ui/modals.css`: Define the class names that `mainUI`/`modals` expect (control labels, buttons, modal layout, debug button positioning). When we externalize the shell styles from `index.html`, they should live alongside these files or a new `/src/styles` directory.

### Hard-coded Text Inventory (needs i18n)

- `index.html`:
  - `<title>Letter Loom Prototype</title>` and the matching header text reuse this English-only label (`index.html:24`, `index.html:218`).
  - Orientation overlay copy `Gira tu dispositivo a VERTICAL para jugar` is baked into the markup (`index.html:210`).
  - Hero section strings: `Prototipo escalado`, the explanatory paragraph `Este área se escala y se centra automáticamente. Prueba en diferentes móviles y orientaciones.`, and placeholder lorem text in `#lorem-normal`/`#lorem-huge` (`index.html:224-247`).
  - Buttons within the demo panel (`Activar/Desactivar bloqueo de pantalla`, `SW Loren`, `Mostrar/ocultar header`, `Mostrar/ocultar footer`) are literal strings toggled in JS (`index.html:235-274`, `index.html:370-375`).
  - Footer text `© 2024 Letter Loom` is hard-coded (`index.html:276`).
  - Video fallback message `Tu navegador no soporta el elemento de video.` lives inside the `<video>` tag (`index.html:282`).
  - `updateScreenInfo()` writes labels `Instalado`, `fromPWA`, `Juego`, `Dispositivo`, and `Zoom` directly into `#screen-info` (`index.html:400-404`).
- `manifest.json`: `name`, `short_name`, and `"description": "A word game for all devices."` are fixed English strings (`manifest.json:2-6`).
- `src/wakeLockManager.js`: Status messages shown to users via `statusElement` are hard-coded in English (`"Status: Wake lock active (standard API)."`, `"Status: Wake lock released by system."`, `"Status: Wake lock active (fallback video)."`, `"Status: Wake lock fallback failed (video error)."`, `"Status: Wake lock inactive."`; `src/wakeLockManager.js:36-95`).
- `src/ui/mainUI.js`:
  - Fallback label `'Reparte'` is used when `TEXTS.dealerLabel` is missing, causing Spanish-only output even with other languages selected (`src/ui/mainUI.js:329`).
  - Timer button fallbacks `'Reanudar'`, `'Go'`, and `'Pausado'` appear when dictionary keys are absent (`src/ui/mainUI.js:460`, `src/ui/mainUI.js:476`, `src/ui/mainUI.js:541`).
  - Debug tooling introduces multiple literals: `"⚙️ Debug"` button text, modal title `"Herramientas de depuración"`, description `"Opciones rápidas para depuración:"`, action labels `"Borrar datos almacenados"`, `"Recargar página"`, `"Resetear juego"`, `"Cerrar"`, confirmation dialog `"Datos borrados"` and `"Todos los datos almacenados han sido eliminados."`, plus the `"OK"` acknowledgement button (`src/ui/mainUI.js:789-828`).
- `score-modal.html`: The heading `Puntuación` and the placeholder `MODAL EXCLUSIVO PARA SCORETRACKING` comment remain in Spanish (`score-modal.html:1-4`).
- `src/version.js`: The literal `APP_VERSION = "v0.0.33"` is embedded; although CI replaces it, showing this string in the UI without localization will expose an English `v` prefix (`src/version.js:3`).

These strings define the backlog for Step 3 ("Internationalize the prototype shell") and subsequent UI migrations: nothing new should be added without routing through `TEXTS`, and existing literals need extraction.

## Target Folder Layout & Migration Rules (Step 2)

Goal: keep the repo flat for GitHub Pages while carving the `src/` tree into clearly owned zones so logic, UI, styles, and localization can evolve independently. The structure below can be created incrementally—files move only when their functionality is stable inside the new slice.

- `/index.html`: Remains the single entry point. Only bootstrapping logic (root containers, script/style tags, PWA meta) lives here; no business strings, no component logic.
- `/assets/`: Unchanged for icons, fonts, audio, video. Any new media used by the UI should land here. Considering create subfolders for grouping each kind of.
- `/src/core/`: Houses headless modules—`gameController.js`, wake-lock helpers (after decoupling DOM refs), data models, and future services. Rules: no direct DOM access, no CSS imports, no localization lookups.
- `/src/ui/`: View controllers and interaction glue. Subdivide as:
  - `/src/ui/shell/`: Orientation overlay, scaling manager, install/telemetry banner logic currently sitting in `index.html`.
  - `/src/ui/screens/`: Feature-specific UIs (setup screen, timers, scoreboard, modals). Each screen imports `TEXTS` for copy and grabs styles via class names only.
  - `/src/ui/components/`: Reusable widgets (buttons, debug tools, modal primitives).
- `/src/styles/`: Pure CSS/SCSS modules. Suggested files:
  - `shell.css` (extracted from `index.html`), `ui-base.css` (existing `main.css`), `modals.css`, plus any future component styles. `index.html` will link these in the desired order.
- `/src/i18n/`: Keep `texts.js`, but add per-domain namespaces (e.g., `prototypeShell`, `wakeLock`, `debugTools`). Export a single registry so UI imports remain stable.
- `/src/platform/`: (Future) Service worker, manifest helpers, and any install/push plumbing. For now it can host `service-worker.js` build sources if we ever stop serving it at the root.

Migration rules:

1. When moving a file, update import paths immediately; no aliasing/bundle tricks for now.
2. If a module needs both DOM access and state handling, split it: state stays in `/src/core`, DOM glue in `/src/ui`.
3. Styles move alongside the feature slice—extract CSS from inline blocks into `/src/styles` before wiring new UI logic.
4. Any file entering `/src/ui` must consume copy via `TEXTS`; add temporary keys if translations aren’t ready.
5. Shared constants (e.g., breakpoints, timers) live in `/src/core/constants.js` (new file) to avoid circular UI dependencies later.

This target layout satisfies Step 2 by defining the destination for each current file and clarifying the rules each slice must follow during migration.

## Clean-Tree Execution Plan

We will keep the legacy implementation intact under a `legacy/` namespace and build the new structure beside it. The goal is to have a working “next” tree that only contains migrated code, while the previous `/src` remains available for reference and emergency fallbacks.

- **Directory convention**:
  - `legacy/`: copy of the current `src`, `score-modal.html`, and related assets. Nothing inside this folder is modified—only read for reference/tests.
  - `src/`: houses the new architecture described earlier (`src/core`, `src/ui`, `src/styles`, etc.). Files appear here only after they have been ported/refactored to respect the new rules (no hard-coded strings, styles decoupled, modular structure).
- **Bootstrap**:
  1. Duplicate the existing `src`, `score-modal.html`, and any other coupled assets into `legacy/` (e.g., `legacy/src`, `legacy/score-modal.html`). Update the reintegration plan to record the snapshot date.
  2. Remove (or rename) the original folders only after the copy is verified; `index.html` will still import from the original `src` until replacements land.
- **Porting workflow**:
  1. For each feature slice, create the new module under `src/` (e.g., `src/core/gameController.js`) and wire `index.html` or other entry points to consume it.
  2. When the new slice reaches parity, update imports to point to the new file and delete or archive the matching file inside `legacy/` (keeping git history for reference).
  3. Document in this plan which pieces still rely on `legacy/` so we know what remains to migrate.
- **Build/serving**:
  - During the transition, `index.html` may import from both `src/...` (new) and `legacy/...` (old). That’s acceptable as long as each import path is explicit. Once all legacy dependencies are gone, we can remove the `legacy/` folder entirely.
  - Service worker, manifest, and assets continue to live at the root; they will be updated when the new tree becomes the default.

Advantages: you gain a clean slate that enforces the new architecture, while still being able to inspect or run the historical code. Risk mitigation: no old files are deleted until their replacements are stable, and the git history + `legacy/` snapshot remain available if something regresses.

### Legacy snapshot log

- **2025-12-07**: Created `legacy/` with copies of `src/`, `assets/`, `index.html`, `index_sav.html`, `score-modal.html`, `manifest.json`, `service-worker.js`, and `README.md`.

### Greenfield rollout status

- **2025-12-07**: Reset `/src` to an empty scaffold (`core/`, `ui/`, `styles/`, `i18n/`). Seeded the new tree with freshly-copied building blocks: `src/i18n/texts.js` (with prototype strings), `src/core/wakeLockManager.js`, and `src/core/version.js`. All other functionality must now be ported manually from `legacy/` as we progress through the plan.
- **2025-12-07**: Cleared the root project surface (removed legacy `assets/`, `index*.html`, `manifest.json`, `service-worker.js`, `score-modal.html`, and `README.md`) so the only working code outside `legacy/` is the new `src/` scaffold plus repository metadata. The live app will be rebuilt from scratch as we reintroduce modules.
- **2025-12-07**: Emptied `/src` entirely (even the initial helper copies) to guarantee every new file is created explicitly during the porting process. `src/` now starts as an empty directory; all code must be reintroduced slice by slice.
- **2025-12-08**: Established the tri-surface layout: `/index.html` (landing), `/install/` (QR + instructions), and `/app/` (PWA with manifest/service worker). Future modules live under `app/src/**`.
