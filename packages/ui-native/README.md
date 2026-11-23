# @dltech/atlas-ui-native

React Native components for the Atlas mobile app. The package reads the design tokens of
`@dltech/atlas-ui`. It draws with `react-native` primitives, so the app and the web share one
palette and one type scale. `apps/mobile` is the only consumer.

## Owns

- The native components: `Alert`, `Avatar`, `Bubble`, `Button`, `Card`, `HarnessNotice`, `Icon`,
  `Input`, `Markdown`, `Reasoning`, `Separator`, `Text`, `Trace`, `AtlasMark` and `BrandMark`.
- The native theme hooks: `useTheme`, `useScheme`, `useIsDark`.
- The native type enums `ETextRole`, `ETextTone`, `EFontFamily`, `EFontWeight`.
- A small markdown renderer with no web view.

## Does not own

- The token values. `@dltech/atlas-ui/tokens` owns them.
- The web components. `@dltech/atlas-ui` owns them.
- Navigation, screens and data. `apps/mobile` owns them.
- The icon set. `lucide-react-native` owns it.

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
  family and a weight.
- `ETextRole`, `ETextTone`, `EFontFamily`, `EFontWeight`: the values of those props.
- `Markdown`: a markdown string as native blocks, including code and tables. The props are
  `value`, `selectable`, `breaks` and `tone`.

### Draw an action or an entry

- `Button` with `IButtonProps`, `EButtonVariant`, `EButtonSize`: a pressable button, which can show
  an icon, a leading node and a loading state.
- `Input` with `IInputProps`, `InputRef`: a text field.
- `Avatar` with `EAvatarSize`, `Icon`: an avatar, and a lucide icon.
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
- Add a component here only when `@dltech/atlas-ui` has no native equivalent.
- Keep `react-native`, `react`, `react-native-svg` and `lucide-react-native` as peer
  dependencies. The app supplies them.

## See also

- `apps/mobile/src/sessions/session-row.tsx` for a real consumer.
- [AGENTS.md](../ui/AGENTS.md) for the token rules the web package states.
