# Palette Agent Configuration & Journal

## Project Rules
- **Target Branch:** Always work directly on the `dev` branch (`git checkout dev`).
- **Language:** Write all git commits, PR/issue comments, inline comments, and task logs in PERSIAN (فارسی).
- **Execution:** Do NOT create any Pull Requests. Commit and push directly to `dev`.

## 2024-07-24 - Accessibility Labels for Icon-only Buttons
**Learning:** Found multiple instances where icon-only buttons lacked `aria-label` or `title` attributes. Adding localized Persian ARIA labels (`aria-label="بستن"`, `title="جستجوی عمومی"`, etc.) immediately improved accessibility for screen readers without any visual regressions or side effects.
**Action:** When adding or auditing icon-only buttons (like SVGs wrapped in a button tag), consistently ensure `aria-label` and `title` attributes are present. Remember to localize the text if the primary app language is not English (e.g., Persian for HikStatus).
