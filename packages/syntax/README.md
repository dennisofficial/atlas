# @dltech/atlas-syntax

Languages for syntax highlighting, with no rendering. The package ships tree-sitter grammars and a
small lexical scanner for the languages that tree-sitter does not cover. A surface picks a tier and
draws the rows itself.

## Owns

- The tree-sitter parser set, its queries and its wasm assets.
- `registerGrammars`, which adds that set to `@opentui/core`.
- The lexical scanner, its language specs and their registry.

## Does not own

- Themes and styled rows. The surfaces own them.
- Which tier a surface uses.
- The parser set of any other library.

## Entry points

| Import                             | Use it for                                       |
| ---------------------------------- | ------------------------------------------------ |
| `@dltech/atlas-syntax/tree-sitter` | The tree-sitter parsers, and `registerGrammars`. |
| `@dltech/atlas-syntax/lexical`     | The lexical scanner, its specs and its registry. |

## Capabilities

### Register the tree-sitter parsers

- `registerGrammars()`: adds the packaged parsers to `@opentui/core`. Call it before the first
  tree-sitter client starts. A grammar that arrives later never reaches that client, and the
  failure is only a warning.

### Scan a language without tree-sitter

- `createScanner(spec)`: returns a `Scanner`, `(source) => LexHighlight[]`.
- `LEXICAL_LANGUAGES`: every packaged `LanguageSpec`.
- `lexicalKeys()`: every key that a spec claims, filetype and aliases together.
- `lexicalSpecFor(language)`: the spec of a language name or info string, or `null`.
- `lexicalScannerFor(language)`: a cached `Scanner`, or `null`.

### Describe a language

- `LanguageSpec`: `filetype`, `aliases`, `rules`, `words`, `caseInsensitive`, `identifier`,
  `number`, `call` and `operators`.
- `ELexRule`: `line`, `span`, `quoted` and `pattern`.
- `LexRule`, `LineRule`, `SpanRule`, `QuotedRule`, `PatternRule`: the rule shapes.
- `LexHighlight`: `[start, end, group]`, as a character offset pair.

## Usage

```ts
import { lexicalScannerFor } from '@dltech/atlas-syntax/lexical'

const scan = lexicalScannerFor('ruby')
const highlights = scan?.(source) ?? []
```

```ts
import { registerGrammars } from '@dltech/atlas-syntax/tree-sitter'

await registerGrammars()
```

## Rules

- Call `registerGrammars` once, before the surface mounts its first tree-sitter client.
- Take a grammar and its queries from the same published version. The rule is in the `$comment` of
  `src/tree-sitter/parsers-config.json`.
- Do not give a lexical language a key that an earlier lexical spec claims. The package throws at
  import. A key that a tree-sitter filetype or alias claims throws in a registry spec, not at
  import.
- Add a tree-sitter language in `src/tree-sitter/parsers-config.json`, then run
  `bun run grammars:update`. Add a lexical language in `src/lexical/languages/`, then register it.

## See also

- [AGENTS.md](./AGENTS.md) for the contributor rules of this package.
- `apps/tui/src/ui/markdown/renderers/lexical.tsx` for a consumer.
