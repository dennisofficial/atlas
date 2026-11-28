# @dltech/atlas-ui

The Atlas design system: vendored shadcn `base-nova` components, the AI patterns built from them,
and the design tokens. `apps/web`, `apps/prototype`, `apps/storybook` and `apps/mobile` consume it.
The package ships TypeScript source with no build step.

## Owns

- The component library in `src/components`, written by the shadcn CLI.
- The AI patterns in `src/ai`: message, tool, reasoning, prompt input, diff viewer, file tree and
  the rest. Each pattern is presentational, with local prop types.
- The design tokens in `src/tokens`, as plain TypeScript.
- The generated stylesheet `theme.css`, and the hand-written `base.css` and `fonts.css`.
- The `cn` helper, the highlighting hooks and the development fixtures.

## Does not own

- Native components. `@dltech/atlas-ui-native` owns them, and it reads these tokens.
- App-specific composition. An app owns a composition that imports a Prisma type or a route.
- Storybook hosting. `apps/storybook` owns it.
- The TypeScript and React versions. The root `package.json` `overrides` pins them.

## Entry points

| Import                               | Use it for                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `@dltech/atlas-ui`                   | `cn` and the tokens, from one import.                                                                    |
| `@dltech/atlas-ui/tokens`            | Pure token values. No platform import.                                                                   |
| `@dltech/atlas-ui/brand`             | Pure brand data: `EBrand`, `BRAND_PATHS`, `brandOfProvider`.                                             |
| `@dltech/atlas-ui/file-icons`        | Pure file and folder icon data and the name → icon resolver. No platform import.                         |
| `@dltech/atlas-ui/sandbox-boot-copy` | The sandbox start title, summary and display rules (open, header error, retry), with no platform import. |
| `@dltech/atlas-ui/components/*`      | A vendored component, such as `components/button`.                                                       |
| `@dltech/atlas-ui/ai/*`              | An AI pattern, such as `ai/message` or `ai/tool`.                                                        |
| `@dltech/atlas-ui/lib/*`             | `lib/utils` (`cn`), `lib/language-of-path`, `lib/shiki-languages`.                                       |
|                                      | `lib/mermaid-parse` checks a diagram source.                                                             |
| `@dltech/atlas-ui/lib/highlighter`   | The lazy shiki highlighter.                                                                              |
| `@dltech/atlas-ui/hooks/*`           | `hooks/use-highlighted-code`, `hooks/use-mobile`.                                                        |
| `@dltech/atlas-ui/fixtures/*`        | Development data, such as `fixtures/settings-agent`.                                                     |
| `@dltech/atlas-ui/fixtures/*.json`   | Raw recorded data, such as `real-transcript.json`.                                                       |
| `@dltech/atlas-ui/theme.css`         | The generated color variables.                                                                           |
| `@dltech/atlas-ui/base.css`          | The base layer and the safe-area variables.                                                              |
| `@dltech/atlas-ui/fonts.css`         | The Geist, JetBrains Mono and Space Grotesk faces.                                                       |

## Capabilities

### Read the tokens

- `semantic`, `EColorScheme`: the light and dark color maps.
- `SemanticTheme`, `SemanticToken`: the theme type and a token name.
- `primitives`, `font`, `radiusBase`, `radiusScale`, `radius`, `radiusPx`, `space`, `spacingUnit`.
- `ETextRole`, `typeScale`, `EFontFamily`, `EFontWeight`, `fontFaceNames`, `REM_PX`.
- `readingClasses`, `readingType`, `readingRole`, `READING_LEADING`, `READING_HEADING_LEADING`,
  `READING_MEASURE_REM`: the measure, the leading and the sizes of transcript text. Native
  body text uses `ETextRole.Reading`, Apple's 17pt body. Web body text stays 16px. Both have a
  26px line.
- `primitives.color.accentChoices` includes the shipped graphite (`#eaeaea`) accent and the sky, clay, slate, moss and plum alternatives.
- `buildThemeCss()`: the stylesheet text for the tokens.

### Mark a brand

- `EBrand`, `BRAND_PATHS`, `BrandPath`: every brand mark, as a titled path for a 24x24 viewBox.
- `brandOfProvider(providerId)`: the brand of a model provider, or `undefined` when it has none.
  Both the web and the native surface read the mark from here.

### Compose an AI pattern

- `ai/message`, `ai/message-response`, `ai/tool`, `ai/reasoning`, `ai/chain-of-thought`.
- `ai/prompt-input`, `ai/confirmation`, `ai/diff-viewer`, `ai/code-viewer`, `ai/file-tree`.
- `ai/chat`, `ai/plan`, `ai/agents-panel`, `ai/terminal`, `ai/preview-browser`.
- `ai/diagram-repair`: `DiagramRepairProvider` gives every `ai/message-response` below it a repair
  handler, and each message hands over its own text, so a broken chart repairs wherever it renders.
  `repairDiagrams={false}` opts one message out, as a streaming reply does.

### Show a file type icon

`ai/file-type-icon` exports `FileTypeIcon` and `FileIconsProvider`. Icons use the basename, with `folder` and `open` selecting folder art. They inherit the text color by default; wrap an explorer in the provider to use the original colors.

```tsx
import { FileIconsProvider, FileTypeIcon } from '@dltech/atlas-ui/ai/file-type-icon'

;<FileIconsProvider colored>
  <FileTypeIcon name="index.ts" className="size-3.5" />
  <FileTypeIcon name="src" folder open className="size-3.5" />
</FileIconsProvider>
```

### Describe the sandbox start

- `sandboxBootTitle(state)`, `sandboxBootSummary({ steps, state, elapsedMs })`: the title and the
  progress of the sandbox start group. `EBootStepState` and `formatElapsed` sit beside them. The
  module has no platform import, so `apps/mobile` reads the same words as `ai/sandbox-boot`.

### Check a diagram

- `lib/mermaid-parse`: `parsesAsMermaid(source)` loads mermaid on demand and reports whether the
  source parses. A repaired diagram is checked with it before it replaces the broken one.

### Highlight code

- `useHighlightedCode(value, language)`: the renderable lines of a code string, once shiki loads.
  A line is a string or a line of React nodes. With no highlighter it returns plain text lines.
- `lib/highlighter`: `loadHighlighter` and the shiki setup.
- `lib/language-of-path`: the language of a file path.

## Usage

An app imports the stylesheets once in its global CSS. Then it imports one component by name.

```ts
import { Button } from '@dltech/atlas-ui/components/button'
import { Alert, AlertDescription } from '@dltech/atlas-ui/components/alert'
```

```css
@import "@dltech/atlas-ui/theme.css";
@import "@dltech/atlas-ui/base.css";
```

## Rules

- Import a component through `@dltech/atlas-ui/components/<name>`. Do not add a second component
  library to an app.
- Use a semantic utility such as `bg-primary` or `text-muted-foreground`. Do not use a raw hex
  value, and do not pass a chrome class such as `p-*`, `gap-*`, `rounded-*` or `shadow-*` to a
  design-system component. A spec fails on it.
- Select a variant with the component's own props. Use `className` only for layout.
- Do not hand-edit `theme.css`. Run `bun run --filter @dltech/atlas-ui generate` after a token
  change.
- Point Tailwind's `@source` at this package's `src/`, and list the package in a Next app's
  `transpilePackages`.
- Import `@dltech/atlas-ui/tokens` in a pure context. It has no platform module.

## See also

- [AGENTS.md](./AGENTS.md) for the vendored files, the deliberate forks and the story rule.
- `docs/package-readmes.md` for the shape of a package README.
