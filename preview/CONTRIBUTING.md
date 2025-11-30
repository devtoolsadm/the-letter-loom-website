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
- Place game logic in `src/gameController.js`.
- Place UI-related code in `src/ui/`.
- Place styles in `src/ui/`.
- Place internationalization (i18n) resources in `src/i18n/`.


## General Practices
- Write modular, reusable code.
- Avoid duplicating logic.
- Use ES6+ features where possible.
- Keep functions short and focused.
- Test your changes before submitting.

## Pull Requests
- Ensure your code follows these guidelines before submitting a PR.
- Describe your changes clearly in the PR description.
- Reference related issues if applicable.

## Other Notes
- The version file (`src/version.js`) is automatically updated by CI/CD. Do not edit it manually.
- For any questions, open an issue or ask in the repository discussion.

---

**Summary:**
- English only for code and comments
- No unnecessary comments
- Consistent, descriptive naming
- Follow project structure

Thank you for helping keep Letter Loom clean and maintainable!
