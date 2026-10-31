import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ERunner, toRunId } from '@dltech/atlas-core'
import { createLocalPodBridge } from '@dltech/atlas-harness'
import { openLocalStore } from '../local-store'
import { createPodThreads } from '../pod-threads'
import { createThreadReads } from '../thread-reads'

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'atlas-mac-held-pods-'))
  const previousHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = home
  const store = openLocalStore({ home })
  const record = await store.threads.create({ workspace: '/w', repo: null })
  const threadId = record.id
  await store.threads.chooseRunner({ threadId, runner: ERunner.Local })
  await store.log.append({
    threadId,
    runId: toRunId('local-run'),
    drafts: [{ type: 'user-said', text: 'From the local transcript' }],
  })
  const bridge = createLocalPodBridge({
    pod: () => ({ home, cloudUrl: 'https://api.test', serveVersion: '1.2.3' }),
    attachmentToken: () => 'token',
    registerPodLease: async () => {
      throw new Error('must not lease a pod')
    },
  })
  const attach = spyOn(bridge, 'attach')
  const create = spyOn(bridge.sandboxes, 'create')
  const pods = createPodThreads({ store, bridge: () => bridge })
  cleanups.push(async () => {
    await pods.release({ threadId })
    await rm(home, { recursive: true, force: true })
    if (previousHome === undefined) delete process.env.ATLAS_HOME
    else process.env.ATLAS_HOME = previousHome
  })
  return { store, pods, threadId, attach, create }
}

describe('held pod channel lookup', () => {
  test('an unheld local rename never holds, attaches, or wakes a pod', async () => {
    const { store, pods, threadId, attach, create } = await fixture()
    const hold = spyOn(pods, 'hold')
    const wake = spyOn(pods, 'wake')
    const reads = createThreadReads({ store, pods })

    expect(pods.channel({ threadId })).toBeUndefined()
    expect(await reads.rename({ threadId, title: 'Saved while parked' })).toBe(true)
    expect((await store.threads.find({ threadId }))?.title).toBe('Saved while parked')
    expect(pods.channel({ threadId })).toBeUndefined()
    expect(hold).not.toHaveBeenCalled()
    expect(wake).not.toHaveBeenCalled()
    expect(attach).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  test('exposes only successfully opened channels and removes them immediately on release', async () => {
    const { pods, threadId, attach, create } = await fixture()
    const opening = pods.hold({ threadId })
    expect(pods.channel({ threadId })).toBeUndefined()
    const pod = await opening
    expect(pods.channel({ threadId })).toBe(pod.attachment.channel)
    const releasing = pods.release({ threadId })
    expect(pods.channel({ threadId })).toBeUndefined()
    await releasing
    expect(attach).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
  })

  test('a released opening cannot restore its channel after it resolves', async () => {
    const { store, pods, threadId } = await fixture()
    const gate = Promise.withResolvers<void>()
    spyOn(store.log, 'refresh').mockImplementationOnce(() => gate.promise)
    const opening = pods.hold({ threadId })
    const releasing = pods.release({ threadId })
    gate.resolve()
    await opening
    await releasing
    expect(pods.channel({ threadId })).toBeUndefined()
  })

  test('a failed older opening cannot evict a newer held channel', async () => {
    const { store, pods, threadId } = await fixture()
    const gate = Promise.withResolvers<void>()
    spyOn(store.log, 'refresh').mockImplementationOnce(() => gate.promise)
    const oldOpening = pods.hold({ threadId })
    const rejected = oldOpening.catch(() => undefined)
    const releasing = pods.release({ threadId })
    const newer = await pods.hold({ threadId })
    gate.reject(new Error('old opening failed'))
    await rejected
    await expect(oldOpening).rejects.toThrow('old opening failed')
    await releasing
    expect(pods.channel({ threadId })).toBe(newer.attachment.channel)
    expect(await pods.hold({ threadId })).toBe(newer)
  })
})
