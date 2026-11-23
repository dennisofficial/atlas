import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import type { ProcessPort, SpawnCommand } from '@dltech/atlas-core'

import { BashTool } from '../bash'
import { files, launcher, processes, useTempAtlasHome } from './support'

useTempAtlasHome()

describe('what the tool tells the model about a background start', () => {
  it('names background true as the way to start a long job without waiting', () => {
    const { description } = new BashTool({ launcher, files, processes })

    expect(description).toContain('`background: true`')
    expect(description).toContain('returns its shellId at once')
    expect(description).not.toContain('runInBackground')
    expect(description).not.toContain('`shell` tool')
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
    const tool = new BashTool({ launcher, files, processes: spyProcesses })

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
