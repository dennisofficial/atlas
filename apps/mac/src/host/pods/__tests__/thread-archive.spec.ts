import { describe, expect, test } from 'bun:test'
import { ERunner, toThreadId } from '@dltech/atlas-core'
import { localPodSchema, threadListSchema } from '../wire'
import { z } from 'zod'
import {
  call,
  create,
  leaseHeaders,
  sharedStore,
  state,
  THREAD,
  useDesktopHost,
} from './pods-host-fixture'

useDesktopHost()

describe('local thread archive', () => {
  test('persists archive and restore in both lists without stopping a running pod', async () => {
    await create()
    const running = [...state.running]
    const leases = leaseHeaders.length
    for (const archived of [true, false]) {
      const response = await call({
        path: `/desktop/threads/${THREAD}/archive`,
        method: 'POST',
        body: { archived },
      })
      expect(response.status).toBe(204)
      expect(await response.text()).toBe('')
      const record = await sharedStore().threads.find({ threadId: toThreadId(THREAD) })
      expect(Boolean(record?.archivedAt)).toBe(archived)
      const threads = threadListSchema.parse(
        await (await call({ path: '/desktop/threads' })).json(),
      )
      const pods = z
        .object({ pods: z.array(localPodSchema) })
        .parse(await (await call({ path: '/desktop/pods' })).json())
      expect(threads.threads).toHaveLength(1)
      expect(pods.pods).toHaveLength(1)
      expect(threads.threads[0]?.archivedAt).toBe(record?.archivedAt)
      expect(pods.pods[0]?.archivedAt).toBe(record?.archivedAt)
      expect([...state.running]).toEqual(running)
      expect(state.destroyed).toEqual([])
      expect(state.created).toHaveLength(1)
      expect(leaseHeaders).toHaveLength(leases)
    }
  })

  test('archives a projectless stopped local thread without provisioning', async () => {
    const { threads } = sharedStore()
    const thread = await threads.create({ workspace: '/here' })
    await threads.chooseRunner({ threadId: thread.id, runner: ERunner.Local })
    expect(
      (
        await call({
          path: `/desktop/threads/${thread.id}/archive`,
          method: 'POST',
          body: { archived: true },
        })
      ).status,
    ).toBe(204)
    expect((await sharedStore().threads.find({ threadId: thread.id }))?.archivedAt).toBeString()
    expect(state.created).toEqual([])
    expect(state.destroyed).toEqual([])
    expect(leaseHeaders).toEqual([])
  })

  test('rejects missing and non-local IDs, invalid inputs and other methods', async () => {
    const { threads } = sharedStore()
    const cloud = await threads.create({ workspace: '/here' })
    await threads.chooseRunner({ threadId: cloud.id, runner: ERunner.Vercel })
    for (const id of ['missing', cloud.id]) {
      expect(
        (
          await call({
            path: `/desktop/threads/${id}/archive`,
            method: 'POST',
            body: { archived: true },
          })
        ).status,
      ).toBe(404)
    }
    for (const body of [{}, { archived: null }, { archived: 'true' }, { archived: 1 }]) {
      expect(
        (await call({ path: `/desktop/threads/${cloud.id}/archive`, method: 'POST', body })).status,
      ).toBe(400)
    }
    for (const method of ['GET', 'DELETE']) {
      expect((await call({ path: `/desktop/threads/${cloud.id}/archive`, method })).status).toBe(
        404,
      )
    }
    expect((await threads.find({ threadId: cloud.id }))?.archivedAt).toBeUndefined()
    expect(await threads.find({ threadId: toThreadId('missing') })).toBeUndefined()
  })
})
