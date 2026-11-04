import type { SemanticTheme } from '@dltech/atlas-ui/tokens'
import { DarkTheme, DefaultTheme } from 'expo-router'

export const navigationThemeOf = ({ theme, dark }: { theme: SemanticTheme; dark: boolean }) => {
  const base = dark ? DarkTheme : DefaultTheme
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: theme.primary,
      background: theme.background,
      card: theme.background,
      text: theme.foreground,
      border: theme.border,
      notification: theme.primary,
    },
  }
}
