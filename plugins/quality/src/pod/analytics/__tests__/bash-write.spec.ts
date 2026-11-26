import { describe, expect, it } from 'bun:test'

import { EToolEffect, toCallId, toThreadId, type ToolCall } from '@dltech/atlas-core'

import { writesIntoWorkspace } from '../bash-write'

const PROJECT = '/repo'

const bash = (input: Record<string, unknown>): ToolCall => ({
  callId: toCallId('call-1'),
  name: 'bash',
  input: { description: 'run it', ...input },
  effect: EToolEffect.Destructive,
  threadId: toThreadId('thread-1'),
})

const writes = (input: Record<string, unknown>): boolean =>
  writesIntoWorkspace({ call: bash(input), projectDirectory: PROJECT })

describe('writesIntoWorkspace', () => {
  it('sees a redirect into a workspace file', () => {
    expect(writes({ command: 'echo "export const a = 1" > src/a.ts' })).toBe(true)
  })

  it('sees a heredoc written into the workspace', () => {
    expect(writes({ command: "cat > src/a.ts <<'EOF'\nexport const a = 1\nEOF" })).toBe(true)
  })

  it('sees an in-place edit and a copy into the workspace', () => {
    expect(writes({ command: "sed -i 's/a/b/' src/a.ts" })).toBe(true)
    expect(writes({ command: 'cp /tmp/a.ts src/a.ts' })).toBe(true)
  })

  it('resolves the target against the workdir', () => {
    expect(writes({ command: 'echo x > a.ts', workdir: '/repo/src' })).toBe(true)
    expect(writes({ command: 'echo x > a.ts', workdir: '/tmp' })).toBe(false)
  })

  it('ignores a write outside the workspace', () => {
    expect(writes({ command: 'echo x > /tmp/scratch.ts' })).toBe(false)
  })

  it('ignores a command that writes nothing', () => {
    expect(writes({ command: 'bun test' })).toBe(false)
    expect(writes({ command: 'git status && cat src/a.ts' })).toBe(false)
    expect(writes({ command: 'bun test > /dev/null 2>&1' })).toBe(false)
  })

  it('ignores a call that is not bash', () => {
    expect(
      writesIntoWorkspace({
        call: { ...bash({ command: 'echo x > src/a.ts' }), name: 'write' },
        projectDirectory: PROJECT,
      }),
    ).toBe(false)
  })

  it('ignores a bash call without a command', () => {
    expect(writes({})).toBe(false)
  })
})
