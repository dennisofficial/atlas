import type { ITheme } from '@xterm/xterm'

const COLOR_VARIABLES: Record<string, string> = {
  background: '--background',
  foreground: '--foreground',
  cursor: '--foreground',
  cursorAccent: '--background',
  selectionBackground: '--accent',
  black: '--muted',
  red: '--destructive',
  green: '--success',
  yellow: '--warning',
  blue: '--link',
  magenta: '--chart-5',
  cyan: '--chart-2',
  white: '--foreground',
  brightBlack: '--muted-foreground',
  brightRed: '--destructive',
  brightGreen: '--success',
  brightYellow: '--warning',
  brightBlue: '--link',
  brightMagenta: '--chart-5',
  brightCyan: '--chart-2',
  brightWhite: '--foreground',
}

export const MONO_FONT_VARIABLE = '--font-mono'

export function terminalThemeOf({ read }: { read: (variable: string) => string }): ITheme {
  const theme: Record<string, string> = {}
  for (const [key, variable] of Object.entries(COLOR_VARIABLES)) {
    const value = read(variable).trim()
    if (value) theme[key] = value
  }
  return theme
}
