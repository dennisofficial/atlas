import { describe, expect, it } from 'bun:test'

import { quotedShellCommand, quotedShellName, shellLabel, shellName } from '../label'

describe('quotedShellCommand', () => {
  it('folds a multi-line command onto one line', () => {
    expect(quotedShellCommand('  bun test \\\n\t--watch  ')).toBe('`bun test \\ --watch`')
  })

  it('clips a folded command past 120 characters', () => {
    expect(quotedShellCommand(`${'a'.repeat(60)}\n\n${'b'.repeat(70)}`)).toBe(
      `\`${'a'.repeat(60)} ${'b'.repeat(59)}…\``,
    )
  })
})

describe('shellLabel', () => {
  it('names the shell and quotes its folded command', () => {
    expect(shellLabel({ command: 'ls\n  -la', description: ' List files ' })).toBe(
      '"List files" (`ls -la`)',
    )
  })

  it('shows the command alone when the description is blank', () => {
    expect(shellLabel({ command: 'ls\n-la', description: '  ' })).toBe('`ls -la`')
  })
})

const names = [
  {
    shell: { command: 'ls', description: '  List  files ' },
    plain: 'List  files',
    quoted: '"List  files"',
  },
  { shell: { command: ' ls\n\t-la ', description: ' \n ' }, plain: 'ls -la', quoted: '`ls -la`' },
  { shell: { command: ' ls\n-la ' }, plain: 'ls -la', quoted: '`ls -la`' },
  {
    shell: { command: 'x'.repeat(121) },
    plain: 'x'.repeat(121),
    quoted: `\`${'x'.repeat(120)}…\``,
  },
]

describe('shellName', () => {
  for (const { shell, plain } of names) {
    it(`names ${JSON.stringify(shell)} as ${plain}`, () => {
      expect(shellName(shell)).toBe(plain)
    })
  }
})

describe('quotedShellName', () => {
  for (const { shell, quoted } of names) {
    it(`names ${JSON.stringify(shell)} as ${quoted}`, () => {
      expect(quotedShellName(shell)).toBe(quoted)
    })
  }
})
