import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { registryFor } from '@dltech/atlas-harness'
import {
  createFileActivityOutcomes,
  createLocalActivityObserver,
} from '@dltech/atlas-harness/activity'
import { localSummaryFixture } from './local-summary-fixture'

test('awaited host stop cancels fresh validation and releases the real activity lock before a new reader opens', async () => {
  const fixture = await localSummaryFixture()
  fixture.socket.holdAfter(1)
  let fetching: Promise<void> | undefined
  try {
    const threadId = await fixture.root({ title: 'Running', endpoint: fixture.socket.url })
    const sessionDir = await registryFor({ home: fixture.home }).sessionDirFor({ threadId })
    const path = join(sessionDir, 'threads', `${threadId}.activity.json`)
    fetching = fixture.call({ path: '/desktop/threads' }).then(
      () => undefined,
      () => undefined,
    )
    await fixture.socket.waitForReads(2)
    expect(await readFile(`${path}.lock`, 'utf8')).toContain('token')
    await fixture.host.stop()
    await fetching
    await expect(readFile(`${path}.lock`)).rejects.toMatchObject({ code: 'ENOENT' })
    await fixture.socket.whenEmpty()
    expect(fixture.socket.sockets.size).toBe(0)
    const reader = createLocalActivityObserver({
      known: async () => true,
      inspector: { inspect: async () => ({ state: 'not-running' }) },
      outcomes: createFileActivityOutcomes({
        pathFor: async () => path,
        validateCurrent: async () => {
          throw new Error('Stopped validation must not attach')
        },
      }),
      open: () => {
        throw new Error('Stopped reader must not attach')
      },
    })
    expect(await reader.read({ threadId, lastAssistantSeq: 1, readSeq: null })).toMatchObject({
      activityState: 'available',
      status: { working: false, lastOutcome: null },
    })
    await reader.close()
    expect(fixture.mutations()).toBe(0)
  } finally {
    await fixture.close()
    await fetching
  }
})
