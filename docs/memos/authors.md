<!-- Authors: Michal Maciejczyk, Claude -->
# Authors line on new files

Every file the agent creates by hand carries an authors line naming Michal Maciejczyk and Claude, so each file records who wrote it.

- **Code** (`.ts`, `.tsx`, `.sql`, `.css`, scripts) — in the file's header comment, in that format's comment syntax. In a module with a `// ─── Name ───` header, it is the header's last line:

  ```ts
  // ─── Category Service ───
  // Handles category CRUD, slug generation, and uniqueness validation.
  // Authors: Michal Maciejczyk, Claude
  ```

- **Markdown** — `<!-- Authors: Michal Maciejczyk, Claude -->` on the first line, or directly after the frontmatter when the file has one (skills keep `---` on line 1).
- **JSON** and tool-generated output (`npm run db:generate` migrations, `react-router typegen`) carry no authors line.
