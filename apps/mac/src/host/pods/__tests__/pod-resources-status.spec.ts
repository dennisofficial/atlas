import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ERunner } from '@dltech/atlas-core'
import { podNameFor } from '@dltech/atlas-harness'
import { podStatusSchema } from '@dltech/atlas-wire'
import { createResourceHost } from './pod-resources-fixture'

let fixture: ReturnType<typeof createResourceHost>
beforeEach(() => {
  fixture = createResourceHost()
})
afterEach(async () => fixture.stop())

describe('passive local pod resource status', () => {
  test('repeated projectless reads report actual allocation without waking, leasing or dialing', async () => {
    const threadId = await fixture.seed()
    fixture.state.resources = { vcpus: 6, memoryMb: 12288 }
    for (let read = 0; read < 3; read += 1) {
      const response = await fixture.call({ threadId })
      expect(response.status).toBe(200)
      const status = await response.json()
      expect(podStatusSchema.safeParse(status).success).toBe(true)
      expect(status).toEqual({
        state: 'running',
        resources: {
          sandboxId: fixture.state.inspected[0],
          region: 'local',
          vcpus: 6,
          memoryMb: 12288,
        },
        steps: [],
      })
    }
    expect(fixture.state.inspected).toEqual(Array(3).fill(podNameFor({ threadId })))
    expect(fixture.state.reads).toEqual(fixture.state.inspected)
    expect(fixture.state).toMatchObject({ creates: 0, leases: 0, dials: 0, bootstraps: 0 })
  })

  test('reports changing actual CPU and memory independently, omitting unknown allocation', async () => {
    const threadId = await fixture.seed({ projectId: 'project-1' })
    expect(await (await fixture.call({ threadId })).json()).toEqual({ state: 'running', steps: [] })
    fixture.state.resources = { vcpus: 4 }
    expect(await (await fixture.call({ threadId })).json()).toEqual({
      state: 'running',
      steps: [],
      resources: { sandboxId: podNameFor({ threadId }), region: 'local', vcpus: 4 },
    })
    fixture.state.resources = { memoryMb: 8192 }
    expect(await (await fixture.call({ threadId })).json()).toEqual({
      state: 'running',
      steps: [],
      resources: { sandboxId: podNameFor({ threadId }), region: 'local', memoryMb: 8192 },
    })
    fixture.state.resources = {}
    expect(await (await fixture.call({ threadId })).json()).toEqual({ state: 'running', steps: [] })
  })

  test('known stopped and absent pods are parked without fabricated boot history or defaults', async () => {
    const threadId = await fixture.seed()
    fixture.state.inspection = { state: 'stopped' }
    expect(await (await fixture.call({ threadId })).json()).toEqual({ state: 'parked', steps: [] })
    fixture.state.inspection = undefined
    expect(await (await fixture.call({ threadId })).json()).toEqual({ state: 'parked', steps: [] })
    expect(fixture.state).toMatchObject({ creates: 0, leases: 0, dials: 0 })
  })

  test('unknown, nonlocal and spawned threads are 404 before any driver inspection', async () => {
    const parent = await fixture.seed()
    const nonlocal = await fixture.seed({ runner: null })
    const cloud = await fixture.seed({ runner: ERunner.Vercel })
    const child = await fixture.seed({ agent: { spawnedBy: parent, type: 'explorer' } })
    for (const threadId of ['unknown-thread', nonlocal, cloud, child]) {
      const response = await fixture.call({ threadId })
      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ code: 'not-found' })
    }
    expect(fixture.state.inspected).toEqual([])
    expect(fixture.state.reads).toEqual([])
    expect(fixture.state).toMatchObject({ creates: 0, leases: 0, dials: 0 })
  })

  test('inspect and allocation failures are 502, not parked or failed status facts', async () => {
    const threadId = await fixture.seed()
    fixture.state.inspectError = new Error('inspect refused')
    const inspect = await fixture.call({ threadId })
    expect(inspect.status).toBe(502)
    expect(await inspect.json()).toEqual({ code: 'pod-failed', message: 'inspect refused' })
    fixture.state.inspectError = undefined
    fixture.state.readError = new Error('allocation unavailable')
    const read = await fixture.call({ threadId })
    expect(read.status).toBe(502)
    expect(await read.json()).toEqual({ code: 'pod-failed', message: 'allocation unavailable' })
    expect(fixture.state).toMatchObject({ creates: 0, leases: 0, dials: 0 })
  })

  test('requires the desktop session cookie and only accepts GET', async () => {
    const threadId = await fixture.seed()
    for (const cookie of ['', 'atlas_desktop=wrong', 'better-auth.session_token=cloud-token']) {
      expect((await fixture.call({ threadId, cookie })).status).toBe(403)
    }
    for (const method of ['POST', 'DELETE']) {
      expect((await fixture.call({ threadId, method })).status).toBe(404)
    }
    expect(fixture.state.inspected).toEqual([])
    expect(fixture.state.reads).toEqual([])
    expect((await fixture.call({ threadId })).status).toBe(200)
  })
})
