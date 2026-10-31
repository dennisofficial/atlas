import { expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { toThreadId } from '@dltech/atlas-core'
import { registryFor, threadReadCursorFile, wireEventOf } from '@dltech/atlas-harness'
import { localThreadSchema, threadListSchema } from '../wire'
import { activitySocketFixture, localSummaryFixture } from './local-summary-fixture'

test('unsupported activity is per row and preserves projectless discovery, cursor, history and rename', async () => {
  const fixture = await localSummaryFixture()
  const unsupported = activitySocketFixture({
    supported: false,
    snapshot: {
      runtimeId: 'old-serve',
      revision: 0,
      turnEpoch: 0,
      working: false,
      awaiting: null,
      observedOutcome: null,
    },
  })
  try {
    const unhealthy = await fixture.root({ title: 'Unsupported root', endpoint: unsupported.url })
    unsupported.setEvents(
      (await fixture.store.log.readOwn({ threadId: unhealthy })).map(wireEventOf),
    )
    const healthy = await fixture.root({ title: 'Healthy root', endpoint: fixture.socket.url })
    await fixture.store.cursor.markRead({ threadId: unhealthy, seq: 1 })
    const response = await fixture.call({ path: '/desktop/threads' })
    expect(response.status).toBe(200)
    const { threads } = threadListSchema.parse(await response.json())
    expect(threads.find((row) => row.threadId === unhealthy)).toMatchObject({
      threadId: unhealthy,
      title: 'Unsupported root',
      projectId: null,
      head: 1,
      lastAssistantSeq: 1,
      readSeq: 1,
      activityState: 'unavailable',
      reason: 'Activity unavailable',
    })
    expect(threads.find((row) => row.threadId === unhealthy)).not.toHaveProperty('status')
    expect(threads.find((row) => row.threadId === healthy)).toMatchObject({
      activityState: 'available',
      lastAssistantSeq: 1,
      readSeq: null,
      status: {
        working: false,
        awaiting: null,
        lastOutcome: null,
        lastAssistantSeq: 1,
        readSeq: null,
      },
    })
    expect((await fixture.call({ path: `/desktop/threads/${unhealthy}/events` })).status).toBe(200)
    expect((await fixture.call({ path: `/desktop/threads/${unhealthy}/read` })).status).toBe(200)
    expect(
      (
        await fixture.call({
          path: `/desktop/threads/${unhealthy}/rename`,
          method: 'POST',
          body: { title: '  Renamed  ' },
        })
      ).status,
    ).toBe(204)
    expect((await fixture.store.threads.find({ threadId: unhealthy }))?.title).toBe('Renamed')
    expect(fixture.mutations()).toBe(0)
  } finally {
    await fixture.close()
    await unsupported.stop()
  }
})

test('inspection and cursor failures preserve independently known facts and resource GET stays independent', async () => {
  const fixture = await localSummaryFixture()
  try {
    const root = await fixture.root({ title: 'Inspect failed', endpoint: 'error' })
    const sessionDir = await registryFor({ home: fixture.home }).sessionDirFor({ threadId: root })
    const cursor = threadReadCursorFile({ sessionDir, threadId: root })
    await writeFile(cursor, 'invalid')
    const response = await fixture.call({ path: '/desktop/threads' })
    const { threads } = threadListSchema.parse(await response.json())
    const row = threads.find((thread) => thread.threadId === root)
    expect(row).toMatchObject({ lastAssistantSeq: 1, head: 1, activityState: 'unavailable' })
    expect(row).not.toHaveProperty('readSeq')
    expect(row).not.toHaveProperty('status')
    expect((await fixture.call({ path: `/desktop/threads/${root}/read` })).status).toBe(502)
    expect(JSON.stringify(row)).not.toContain('unsafe-token')
    fixture.run({ threadId: root, url: fixture.socket.url })
    const resources = await fixture.call({ path: `/desktop/pods/${root}/status` })
    expect(resources.status).toBe(200)
    expect(fixture.socket.requests).toEqual([])
    expect(fixture.mutations()).toBe(0)
    expect(localThreadSchema.safeParse(row).success).toBe(true)
  } finally {
    await fixture.close()
  }
})

test('unknown and nonlocal roots are never inspected and host close drops passive sockets', async () => {
  const fixture = await localSummaryFixture()
  try {
    await fixture.store.threads.create({
      id: toThreadId('nonlocal'),
      workspace: '/workspace',
      repo: null,
    })
    expect(await (await fixture.call({ path: '/desktop/threads' })).json()).toEqual({ threads: [] })
    expect(fixture.inspections()).toBe(0)
    expect((await fixture.call({ path: '/desktop/threads/no-such-root/read' })).status).toBe(404)
    expect(fixture.inspections()).toBe(0)
    await fixture.root({ title: 'Running', endpoint: fixture.socket.url })
    expect((await fixture.call({ path: '/desktop/threads' })).status).toBe(200)
    expect(fixture.socket.sockets.size).toBeGreaterThan(0)
    const socketsClosed = fixture.socket.whenEmpty()
    await fixture.host.stop()
    await socketsClosed
    expect(fixture.socket.sockets.size).toBe(0)
    expect(fixture.mutations()).toBe(0)
  } finally {
    await fixture.close()
  }
})
