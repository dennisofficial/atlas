import { afterEach, describe, expect, it } from 'bun:test'

import { projectDirectoryOf } from '@dltech/atlas-core'

import type { OpenedSupervisor } from './fixtures'
import { append, openChild, openFamily } from './transferred-fixture'

const opened: OpenedSupervisor[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) await entry.close()
})

const WORKTREE = '/repo/.atlas/worktrees/child-topic'

const directoryOf = async (
  entry: OpenedSupervisor,
  threadId: Parameters<typeof openChild>[0]['spawnedBy'],
) =>
  projectDirectoryOf({
    events: await entry.harness.log.read({ threadId }),
    launchDirectory: '/launch',
  })

describe('a sub-agent that enters a worktree', () => {
  it('moves its own project directory and leaves its parent where it was', async () => {
    const entry = await openFamily(opened)
    const child = await openChild({ entry, spawnedBy: entry.parent })

    await append(entry, child, [
      { type: 'worktree-entered', path: WORKTREE, branch: 'child-topic', base: 'origin/main' },
    ])

    expect(await directoryOf(entry, child)).toBe(WORKTREE)
    expect(await directoryOf(entry, entry.parent)).toBe('/launch')
  })
})
