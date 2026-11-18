import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import type { ProcessPort, SpawnCommand } from '@dltech/atlas-core'

import { ForegroundOnlyShells } from '../../runtime/foreground-shells'
import { BashTool } from '../bash'
import { files, processes, useTempAtlasHome } from './support'

useTempAtlasHome()

describe('the silent-shell timeout', () => {
  it('names the silent-shell timeout in the description, and no check-in cadence', () => {
    const { description } = new BashTool(new ForegroundOnlyShells(), files, processes)

    expect(description).toContain('30 minutes')
    expect(description).not.toContain('checkInMs')
    expect(description).not.toContain('check-in')
  }, 30_000)
})

describe('what the tool tells the model about watching', () => {
  it('warns that a watch on the success marker alone is silent through a crash', () => {
    const { description } = new BashTool(new ForegroundOnlyShells(), files, processes)

    expect(description).toContain('silence is indistinguishable from progress')
  }, 30_000)
})

describe('routing the spawn by thread', () => {
  it('carries the calling thread onto the spawn, so a routed port can place it', async () => {
    const spawned: SpawnCommand[] = []
    const spyProcesses: ProcessPort = {
      spawn: (args: SpawnCommand) => {
        spawned.push(args)
        return {
          stdout: new ReadableStream({ start: (controller) => controller.close() }),
          stderr: new ReadableStream({ start: (controller) => controller.close() }),
          exited: Promise.resolve(0),
          terminate: () => undefined,
        }
      },
      which: () => null,
    }
    const tool = new BashTool(new ForegroundOnlyShells(), files, spyProcesses)

    const outcome = await tool.invoke({
      input: { command: 'echo hi', description: 'Probe the spawn' },
      signal: new AbortController().signal,
      idempotencyKey: 'bash-thread-routing',
      projectDirectory: '/tmp',
      threadId: toThreadId('thread-1'),
    })

    expect(outcome.ok).toBe(true)
    expect(spawned[0]?.threadId).toBe(toThreadId('thread-1'))
  }, 30_000)
})
