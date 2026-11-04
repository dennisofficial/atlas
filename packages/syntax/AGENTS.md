# @dltech/atlas-syntax

Languages for syntax highlighting, with no rendering: tree-sitter grammars (`src/tree-sitter`) and the lexical scanner tier (`src/lexical`). Themes and styled rows stay in the surfaces.
- Tree-sitter language: add an entry to `src/tree-sitter/parsers-config.json`, then `bun run grammars:update`. Grammar and queries must come from the same version; the rule is in the config's `$comment`.
- Lexical language: add a spec in `src/lexical/languages/`, register it in `languages/index.ts`, and add `languages/__tests__/<filetype>.spec.ts`. A key must not also be a tree-sitter filetype or alias; `registry.spec.ts` enforces it.
- Run `bun test` inside this package so its `bunfig.toml` preloads apply.
