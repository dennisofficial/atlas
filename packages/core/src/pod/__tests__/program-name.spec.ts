import { describe, expect, it } from 'bun:test'

import { programNameOf } from '../program-name'

describe('the program name of a shell command', () => {
  it('skips a cd to an absolute path and the pipe after the program', () => {
    expect(
      programNameOf(
        'cd /atlas/workspaces/atlas/.atlas/worktrees/dennis/catchup-fast/apps/api && bunx tsc --noEmit -p . 2>&1 | tail -15',
      ),
    ).toBe('tsc')
  })

  it('skips environment assignments and timeout wrappers', () => {
    expect(
      programNameOf(
        'cd /repo/apps/web && NODE_OPTIONS=--max-old-space-size=2048 timeout 900 bunx tsc -p .',
      ),
    ).toBe('tsc')
  })

  it('keeps the subcommand of a package runner', () => {
    expect(programNameOf('bun run --cwd apps/api bench:stream')).toBe('bun run')
    expect(programNameOf('bunx turbo run typecheck')).toBe('turbo run')
  })

  it('names a plain program by its basename', () => {
    expect(programNameOf('/usr/bin/python3 script.py')).toBe('python3')
  })

  it('falls back to the whole command when nothing remains', () => {
    expect(programNameOf('cd /tmp')).toBe('cd /tmp')
  })
})
