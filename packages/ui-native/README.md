# @dltech/atlas-ui-native

React Native components for the Atlas mobile app. The package reads the design tokens of
`@dltech/atlas-ui`. It draws with `react-native` primitives, so the app and the web share one
palette and one type scale. `apps/mobile` is the only consumer.

## Owns

- The native components: `Alert`, `Avatar`, `Bubble`, `Button`, `Card`, `CodeBlock`, `HarnessNotice`,
  `Icon`, `Input`, `Markdown`, `Reasoning`, `Separator`, `Spinner`, `Text`, `Trace`, `AtlasMark`,
  `BrandMark` and `FileTypeIcon`.
- The native theme hooks: `useTheme`, `useScheme`, `useIsDark`.
- The native type enums `ETextRole`, `ETextTone`, `EFontFamily`, `EFontWeight`.
- A small markdown renderer with no web view.

## Does not own

- The token values. `@dltech/atlas-ui/tokens` owns them.
- The web components. `@dltech/atlas-ui` owns them.
- Navigation, screens and data. `apps/mobile` owns them.
- The general icon set. `lucide-react-native` owns it. File and folder artwork comes from
  `@dltech/atlas-ui/file-icons`.

## Entry points

| Import                    | Use it for                                        |
| ------------------------- | ------------------------------------------------- |
| `@dltech/atlas-ui-native` | Every native component, theme hook and type enum. |

## Capabilities

### Draw a surface

- `Card`, `CardList`, `CardRow`: a card, and the rows of a divided list.
- `Alert` with `EAlertTone`: a short message with an icon.
- `HarnessNotice` with `EHarnessNoticeTone`: a notice from the harness.
- `Separator`, `Rule`: a line between two items.
- `AtlasMark`: the Atlas mark.
- `BrandMark`: the mark of a brand from `@dltech/atlas-ui/brand`. It takes the brand, a `size` in
  pixels and the `color` for a mark that draws in the current colour.

### Draw text

- `Text` with `ITextProps`: a styled text run. It takes a `size` from `ETextRole`, a tone, a
  family and a weight. A `selectable` Text on iOS is a `UITextView`
  (`@bsky.app/react-native-uitextview`): a long press selects a word, handles extend the range and
  the native edit menu acts on it. Nested Text spans keep their style and `onPress`.
- `ETextRole`, `ETextTone`, `EFontFamily`, `EFontWeight`: the values of those props.
- `Markdown` with `IMarkdownProps`: a markdown string as native blocks, including code and tables.
  `breaks` keeps a newline inside a paragraph as a line break. `renderDiagram` takes
  `IRenderDiagramArgs`, `{ source, closed }`, for a fenced block whose language is `mermaid`, so the
  app can draw a real diagram in place of the code. Without it, a mermaid fence draws as code.
- `CodeBlock`: a fenced code block with its language header and a horizontal scroll body.

### Draw an action or an entry

- `Button` with `IButtonProps`, `EButtonVariant`, `EButtonSize`: a pressable button, which can show
  an icon, a leading node and a loading state. `hitSlop` widens the touch area past the
  44 pt minimum, and `onPressIn` / `onPressOut` drive press feedback such as a bounce.
- `Input` with `IInputProps`, `InputRef`: a text field.
- `Avatar` with `EAvatarSize`, `Icon`: an avatar, and a lucide icon.
- `FileTypeIcon`: a file or folder icon matched by `name`. Pass `folder` and `open` for folder
  state, `colored` for source colours (monochrome by default), and `size` in pixels (16 by default).
- `Spinner`: the Atlas loading spinner, the same turning `LoaderCircle` as the web `Spinner`.
- `Bubble`, `MessageActions`, `MessageAction`, `MessageFooter`: a message and its actions.

### Draw a run

- `Trace`, `TraceLine`, `TraceIcon`, `Step`, `ETraceStatus`: the rows of an agent trace.
- `Reasoning`: a reasoning block.

### Read the theme

- `useTheme()`: the semantic theme of the current scheme.
- `useScheme()`, `useIsDark()`: the scheme, and whether it is dark.
- `resolveTheme(system)`, `schemeOf(system)`: the same values without a hook.
- `withAlpha({ color, alpha })`: a `#rrggbb` color with an alpha channel.

## Usage

```tsx
import { ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'

const Row = ({ label }: { label: string }) => (
  <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={{ padding: space(2) }}>
    {label}
  </Text>
)
```

## Rules

- Read a color through `useTheme()` or `resolveTheme`. Do not hard-code a color value.
- Read a size through `space`, `radius` or `typeScale` from `@dltech/atlas-ui/tokens`.
- Use `lucide-react-native` for an icon, and pass it to `Icon`.
- Show loading with `Spinner`, never the iOS `ActivityIndicator`.
- Add a component here only when `@dltech/atlas-ui` has no native equivalent.
- Keep `react-native`, `react`, `react-native-svg`, `lucide-react-native` and
  `@bsky.app/react-native-uitextview` as peer dependencies. The app supplies them.

## See also

- `apps/mobile/src/sessions/session-row.tsx` for a real consumer.
- [AGENTS.md](../ui/AGENTS.md) for the token rules the web package states.
