import { describe, expect, it } from 'bun:test'

import { joinCommandLine, parseKeyValueLines, splitCommandLine } from '../command-line'

describe('splitCommandLine', () => {
  it('splits a command and its arguments, honouring quotes', () => {
    expect(splitCommandLine('bunx @playwright/mcp@latest')).toEqual({
      command: 'bunx',
      args: ['@playwright/mcp@latest'],
    })
    expect(splitCommandLine('  npx -y "my server"  ')).toEqual({
      command: 'npx',
      args: ['-y', 'my server'],
    })
    expect(splitCommandLine('')).toEqual({ command: '', args: [] })
  })
})

describe('joinCommandLine', () => {
  it('quotes only the tokens that need it', () => {
    expect(joinCommandLine({ command: 'bunx', args: ['tool', 'my server'] })).toBe(
      'bunx tool "my server"',
    )
    expect(joinCommandLine({ command: 'run', args: ["it's"] })).toBe('run "it\'s"')
    expect(joinCommandLine({ command: 'run', args: ['say "hi"'] })).toBe('run \'say "hi"\'')
  })

  it('round-trips a command line', () => {
    const line = 'bunx "my tool" --flag'
    expect(joinCommandLine(splitCommandLine(line))).toBe(line)
  })
})

describe('parseKeyValueLines', () => {
  it('reads one pair per line and skips blanks, comments and malformed lines', () => {
    expect(
      parseKeyValueLines({
        text: '# comment\nA=1\n\nB = two words \nmalformed\n',
        separator: '=',
      }),
    ).toEqual({ A: '1', B: 'two words' })
  })

  it('reads headers by the first colon', () => {
    expect(parseKeyValueLines({ text: 'Authorization: Bearer abc:def', separator: ':' })).toEqual({
      Authorization: 'Bearer abc:def',
    })
  })
})
