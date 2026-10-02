import { writeFile } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'bun:test'

import {
  buildSession,
  manifestFor,
  removeFixtureHomes,
  rootThread,
} from './workspace-session-fixture'

afterEach(removeFixtureHomes)

describe('preparing a workspace export through the session', () => {
  it('freezes the root family, then stops the processes, then captures', async () => {
    const order: string[] = []
    const frozen: string[] = []
    const { session, exported } = await buildSession({
      family: {
        pauseChildren: async () => undefined,
        freeze: async ({ threadId }) => {
          frozen.push(threadId)
          order.push('freeze')
        },
      },
      stopWorkspaceProcesses: async () => {
        order.push('stop')
      },
      capture: async ({ cwd, destination }) => {
        order.push('capture')
        await writeFile(destination, 'tar')
        return manifestFor(cwd)
      },
    })

    const reply = await session.prepare()

    expect(order).toEqual(['freeze', 'stop', 'capture'])
    expect(frozen).toEqual([rootThread])
    expect(await exported()).toHaveLength(1)
    expect(reply.manifest.version).toBe(1)
  })

  it('exports an idle session that has no family to freeze', async () => {
    const { session, events, exported } = await buildSession({ family: undefined })

    await session.prepare()

    expect(events).toEqual(['stop', 'capture'])
    expect(await exported()).toHaveLength(1)
  })

  it('exports when the family offers pausing but no freeze', async () => {
    const { session, exported } = await buildSession({ family: { pauseChildren: async () => undefined } })

    await session.prepare()

    expect(await exported()).toHaveLength(1)
  })

  it('takes no snapshot when the processes will not stop before the deadline', async () => {
    let captures = 0
    const { session, exported } = await buildSession({
      stopWorkspaceProcesses: async () => {
        throw new Error('background processes are still writing to the workspace')
      },
      capture: async ({ destination, cwd }) => {
        captures += 1
        await writeFile(destination, 'tar')
        return manifestFor(cwd)
      },
    })

    await expect(session.prepare()).rejects.toThrow('still writing to the workspace')

    expect(captures).toBe(0)
    expect(await exported()).toEqual([])
  })

  it('stops and captures nothing when the freeze itself fails', async () => {
    const { session, events, exported } = await buildSession({
      family: {
        pauseChildren: async () => undefined,
        freeze: async () => {
          throw new Error('a child would not halt')
        },
      },
    })

    await expect(session.prepare()).rejects.toThrow('would not halt')

    expect(events).toEqual([])
    expect(await exported()).toEqual([])
  })
})
