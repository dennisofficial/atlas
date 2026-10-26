import { describe, expect, it } from 'bun:test'

import { terminalThemeOf } from '../internal/terminal-theme'

describe('terminalThemeOf', () => {
  it('maps design tokens to xterm colors and skips unset ones', () => {
    const values: Record<string, string> = {
      '--background': ' #111 ',
      '--foreground': '#eee',
      '--success': '#0f0',
    }
    const theme = terminalThemeOf({
      read: (variable) => values[variable] ?? '',
    })
    expect(theme.background).toBe('#111')
    expect(theme.green).toBe('#0f0')
    expect(theme.brightGreen).toBe('#0f0')
    expect(theme.red).toBeUndefined()
  })
})
