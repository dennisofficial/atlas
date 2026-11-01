import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toThreadId } from '@dltech/atlas-core'
import type { ReadActivityReply } from '@dltech/atlas-wire'
import { createFileActivityOutcomes } from '../file-outcomes'
import { createCurrentActivityValidator } from '../local-inspection'
import { createPassiveActivityConnection } from '../passive-activity-connection'
import { activitySocketFixture } from './activity-socket-fixture'

const threadId = toThreadId('root')
const oldSnapshot: ReadActivityReply = {
  runtimeId: 'old',
  revision: 2,
  turnEpoch: 1,
  working: false,
  awaiting: null,
  observedOutcome: { identity: { kind: 'run', runId: 'old-run' }, outcome: 'completed' },
}

test('a fresh locked validation reaches the replaced listener while the old authenticated socket remains alive', async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-current-endpoint-'))
  const path = join(home, 'root.activity.json')
  const old = activitySocketFixture({ snapshot: oldSnapshot })
  const endpoint = { url: old.url }
  const open = () =>
    createPassiveActivityConnection({
      threadId,
      endpoint,
      token: () => 'existing-token',
      invalidate: () => undefined,
      disconnect: () => undefined,
    })
  const oldConnection = open()
  const validateCurrent = createCurrentActivityValidator({
    inspector: { inspect: async () => ({ state: 'running', endpoint }) },
    open: () => open(),
  })
  const retainedPath = join(home, 'retained.activity.json')
  const retained = createFileActivityOutcomes({
    pathFor: async () => retainedPath,
    validateCurrent,
  })
  let replacement: ReturnType<typeof activitySocketFixture> | undefined
  try {
    expect(await oldConnection.read()).toEqual(oldSnapshot)
    await retained.observe({ threadId, candidate: oldSnapshot })
    const oldStored = await readFile(retainedPath, 'utf8')
    void old.stopListening()
    const newSnapshot: ReadActivityReply = {
      ...oldSnapshot,
      runtimeId: 'new',
      revision: 0,
      turnEpoch: 0,
      observedOutcome: null,
    }
    replacement = activitySocketFixture({ port: old.port, snapshot: newSnapshot })
    expect(old.sockets.size).toBeGreaterThan(0)
    expect(await oldConnection.read()).toEqual(oldSnapshot)
    await expect(retained.observe({ threadId, candidate: oldSnapshot })).rejects.toThrow(
      'runtime changed',
    )
    expect(await readFile(retainedPath, 'utf8')).toBe(oldStored)
    expect((await retained.observe({ threadId, candidate: newSnapshot })).outcome).toEqual(
      oldSnapshot.observedOutcome,
    )
    const outcomes = createFileActivityOutcomes({ pathFor: async () => path, validateCurrent })
    await expect(outcomes.observe({ threadId, candidate: oldSnapshot })).rejects.toThrow(
      'runtime changed',
    )
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await outcomes.observe({ threadId, candidate: newSnapshot })).snapshot.runtimeId).toBe(
      'new',
    )
    const original = await readFile(path, 'utf8')
    await expect(outcomes.observe({ threadId, candidate: oldSnapshot })).rejects.toThrow(
      'runtime changed',
    )
    expect(await readFile(path, 'utf8')).toBe(original)
    expect(await oldConnection.read()).toEqual(oldSnapshot)
    expect(replacement.reads()).toBe(5)
  } finally {
    await oldConnection.close()
    await validateCurrent.close()
    await replacement?.stop()
    await old.stop()
    await rm(home, { recursive: true, force: true })
  }
})
