import { describe, expect, it } from 'bun:test'

import { ETerminalEntry, type UserTerminal } from '../sandbox-terminal'
import { nextInputOf, scrollbackOf } from '../terminal-ansi'

describe('nextInputOf', () => {
  it('echoes printable keys and accumulates the buffer', () => {
    expect(nextInputOf({ buffer: 'l', data: 's' })).toEqual({ buffer: 'ls', echo: 's' })
  })

  it('submits the trimmed command on enter', () => {
    expect(nextInputOf({ buffer: ' ls ', data: '\r' })).toEqual({
      buffer: '',
      echo: '\r\n',
      command: 'ls',
    })
  })

  it('erases on backspace and ignores escape sequences', () => {
    expect(nextInputOf({ buffer: 'ab', data: '\u007f' })).toEqual({ buffer: 'a', echo: '\b \b' })
    expect(nextInputOf({ buffer: '', data: '\u007f' })).toEqual({ buffer: '', echo: '' })
    expect(nextInputOf({ buffer: 'a', data: '\u001b[A' })).toEqual({ buffer: 'a', echo: '' })
  })
})

describe('scrollbackOf', () => {
  it('renders commands after a prompt and output with CRLF line ends', () => {
    const terminal: UserTerminal = {
      id: 't',
      label: 'T',
      cwd: '~',
      entries: [
        { kind: ETerminalEntry.Command, cwd: '~', command: 'ls' },
        { kind: ETerminalEntry.Output, text: 'a\nb' },
      ],
    }
    const text = scrollbackOf(terminal)
    expect(text).toContain('ls\r\n')
    expect(text).toContain('a\r\nb\r\n')
  })
})
