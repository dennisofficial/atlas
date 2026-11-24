import { describe, expect, it } from 'bun:test'

import { quotedShellCommand, shellLabel } from '../label'

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
