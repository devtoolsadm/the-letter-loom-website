# Contributing Guidelines for Letter Loom

Thank you for contributing to Letter Loom! To keep the codebase clean and maintainable, please follow these conventions and rules:


## Code Style & Naming
- **Language:** All code comments, variable names, and identifiers must be in English.
- **Naming:** Use clear, descriptive, and consistent variable and function names in English.
- **Comments:**
  - Only add comments when necessary for clarity or to explain non-obvious logic.
  - Avoid superfluous or redundant comments (do not restate what the code already expresses clearly).
  - Comments must always be in English.
  - Comments must never reference the chat, prompts, or any conversation context. All comments must be self-contained and understandable on their own, as the chat will not be accessible in the future.
  - Do not include phrases like "as discussed above", "option B", or similar references to chat or prompt instructions.

## File Organization
- `legacy/`: Frozen snapshot for reference; do not modify when implementing new features.
- `src/core/`: Framework-agnostic logic (e.g., `gameController`, wake lock helpers, version file).
- `src/ui/`: Presentation controllers and components (screens, modals, shell).
- `src/styles/`: Plain CSS modules imported by the UI.
- `src/i18n/`: Language packs and utilities.
- `assets/`: Game media (icons, fonts, audio, video).


## General Practices
- Write modular, reusable code.
- Avoid duplicating logic.
- Use ES6+ features where possible.
- Keep functions short and focused.
- Test your changes before submitting.
- Use `src/core/logger.js` for debug/info/error reporting instead of `console.*` directly. The logger automatically mirrors to the console and the in-app log panel; this ensures logs are visible on mobile builds. If you need a new log level, extend the logger module rather than logging ad hoc.
- UI typography must use fixed-size units (px) so the design is not affected by OS/browser font-scaling preferences or zoom overrides.

## Pull Requests
- Ensure your code follows these guidelines before submitting a PR.
- Describe your changes clearly in the PR description.
- Reference related issues if applicable.

## Other Notes
- The version file (`src/core/version.js`) is automatically updated by CI/CD. Do not edit it manually.
- For any questions, open an issue or ask in the repository discussion.

---

**Summary:**
- English only for code and comments
- No unnecessary comments
- Consistent, descriptive naming
- Follow project structure

Thank you for helping keep Letter Loom clean and maintainable!
