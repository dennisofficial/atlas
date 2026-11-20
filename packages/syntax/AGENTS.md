# @dltech/atlas-syntax

This package holds languages for syntax highlighting and does no rendering: tree-sitter grammars (`src/tree-sitter`) and the lexical scanner tier (`src/lexical`). Themes and styled rows stay in the surfaces.
- To add a tree-sitter language, add an entry to `src/tree-sitter/parsers-config.json`, then run `bun run grammars:update`. A grammar and its queries must come from the same version. The rule is in the config's `$comment`.
- To add a lexical language, add a spec in `src/lexical/languages/`. Register it in `languages/index.ts`. Add `languages/__tests__/<filetype>.spec.ts`. A key must not also be a tree-sitter filetype or an alias. `registry.spec.ts` enforces it.
- Run `bun test` inside this package, so that its `bunfig.toml` preloads apply.
