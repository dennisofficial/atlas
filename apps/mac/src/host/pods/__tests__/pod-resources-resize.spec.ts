import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ERunner } from '@dltech/atlas-core'
import { podNameFor } from '@dltech/atlas-harness'
import { podResizeReplySchema } from '@dltech/atlas-wire'
import { createResourceHost } from './pod-resources-fixture'

let fixture: ReturnType<typeof createResourceHost>
beforeEach(() => {
  fixture = createResourceHost()
})
afterEach(async () => fixture.stop())

describe('explicit local pod resize', () => {
  test('updates the actual projectless pod live without inspection, reads, wakes or leases', async () => {
    const threadId = await fixture.seed()
    const before = await fixture.store.threads.find({ threadId })
    const response = await fixture.call({
      threadId,
      action: 'resize',
      method: 'POST',
      body: { vcpus: 8 },
    })
    expect(response.status).toBe(200)
    const reply = await response.json()
    expect(podResizeReplySchema.safeParse(reply).success).toBe(true)
    expect(reply).toEqual({ vcpus: 8, appliesAt: 'live' })
    expect(fixture.state.updates).toEqual([{ name: podNameFor({ threadId }), vcpus: 8 }])
    expect(fixture.state.inspected).toEqual([])
    expect(fixture.state.reads).toEqual([])
    expect(fixture.state).toMatchObject({ creates: 0, leases: 0, dials: 0, bootstraps: 0 })
    expect(await fixture.store.threads.find({ threadId })).toEqual(before)
  })

  test('accepts exactly 2, 4, 6 and 8 vcpus for a project-backed root', async () => {
    const threadId = await fixture.seed({ projectId: 'project-1' })
    for (const vcpus of [2, 4, 6, 8]) {
      const response = await fixture.call({
        threadId,
        action: 'resize',
        method: 'POST',
        body: { vcpus },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ vcpus, appliesAt: 'live' })
    }
    expect(fixture.state.updates.map((update) => update.vcpus)).toEqual([2, 4, 6, 8])
    expect(fixture.state).toMatchObject({ creates: 0, leases: 0, dials: 0 })
  })

  test('rejects malformed JSON, unknown fields and unsupported CPU values without driver work', async () => {
    const threadId = await fixture.seed()
    for (const body of [
      {},
      null,
      [],
      4,
      { vcpus: '4' },
      { vcpus: null },
      { vcpus: true },
      ...[0, -2, 1, 3, 5, 7, 10, 4.5].map((vcpus) => ({ vcpus })),
      { vcpus: 4, threadId },
      { vcpus: 4, extra: true },
    ]) {
      const response = await fixture.call({ threadId, action: 'resize', method: 'POST', body })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ code: 'invalid-input' })
    }
    const malformed = await fixture.call({
      threadId,
      action: 'resize',
      method: 'POST',
      rawBody: '{',
    })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({ code: 'invalid-input' })
    expect(fixture.state.updates).toEqual([])
    expect(fixture.state.inspected).toEqual([])
    expect(fixture.state.reads).toEqual([])
  })

  test('unknown, nonlocal and spawned threads cannot resize a pod', async () => {
    const parent = await fixture.seed()
    const nonlocal = await fixture.seed({ runner: null })
    const cloud = await fixture.seed({ runner: ERunner.Vercel })
    const child = await fixture.seed({ agent: { spawnedBy: parent, type: 'explorer' } })
    for (const threadId of ['unknown-thread', nonlocal, cloud, child]) {
      const response = await fixture.call({
        threadId,
        action: 'resize',
        method: 'POST',
        body: { vcpus: 2 },
      })
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ code: 'not-found' })
    }
    expect(fixture.state.updates).toEqual([])
    expect(fixture.state.inspected).toEqual([])
    expect(fixture.state).toMatchObject({ creates: 0, leases: 0, dials: 0 })
  })

  test('surfaces the actual update error as 502 without a wake fallback or persisted defaults', async () => {
    const threadId = await fixture.seed()
    const before = await fixture.store.threads.find({ threadId })
    fixture.state.inspection = undefined
    fixture.state.resizeError = new Error('Docker update: container missing')
    const response = await fixture.call({
      threadId,
      action: 'resize',
      method: 'POST',
      body: { vcpus: 4 },
    })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      code: 'pod-failed',
      message: 'Docker update: container missing',
    })
    expect(fixture.state.updates).toEqual([{ name: podNameFor({ threadId }), vcpus: 4 }])
    expect(fixture.state.inspected).toEqual([])
    expect(fixture.state.reads).toEqual([])
    expect(fixture.state).toMatchObject({ creates: 0, leases: 0, dials: 0 })
    expect(await fixture.store.threads.find({ threadId })).toEqual(before)
  })

  test('requires the desktop session cookie and only accepts POST', async () => {
    const threadId = await fixture.seed()
    for (const cookie of ['', 'atlas_desktop=wrong', 'better-auth.session_token=cloud-token']) {
      const response = await fixture.call({
        threadId,
        action: 'resize',
        method: 'POST',
        body: { vcpus: 4 },
        cookie,
      })
      expect(response.status).toBe(403)
    }
    for (const method of ['GET', 'DELETE']) {
      expect((await fixture.call({ threadId, action: 'resize', method })).status).toBe(404)
    }
    expect(fixture.state.updates).toEqual([])
    expect(fixture.state).toMatchObject({ creates: 0, leases: 0, dials: 0 })
  })
})
