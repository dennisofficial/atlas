import { afterEach, describe, expect, it } from 'bun:test'

import { ECredentialAvailability, projectWaiting, type ThreadId } from '@dltech/atlas-core'

import { buildHarness, type AtlasHarness } from '../../loop/build-harness'
import { createTempHome, type TempHome } from '../../loop/__tests__/temp-home'
import { scriptedModel } from '../../model/testing/scripted-model'
import { ModelWaitState } from '../wait-state'
import { waitingOfBlock } from '../waiting-of-block'
import { blockedError } from './block-fixtures'

const opened: { harness: AtlasHarness; temp: TempHome }[] = []

afterEach(async () => {
  for (const entry of opened.splice(0)) {
    await entry.harness.close()
    entry.temp.discard()
  }
})

async function open() {
  const temp = createTempHome()
  const harness = await buildHarness({
    home: temp.home,
    model: scriptedModel({ script: [] }),
  })
  opened.push({ harness, temp })
  const root = (await harness.threads.create({})).id
  const state = () =>
    new ModelWaitState({
      log: harness.log,
      ids: harness.ids,
      threads: harness.threads,
    })
  return { harness, root, state }
}

const waitingEvents = async (harness: AtlasHarness, root: ThreadId) =>
  (await harness.log.readOwn({ threadId: root })).filter(
    (event) => event.type === 'model-waiting' || event.type === 'model-wait-cleared',
  )

const waitingFor = (threadId: ThreadId, args?: Parameters<typeof blockedError>[0]) =>
  waitingOfBlock({ error: blockedError(args), threadId })

describe('ModelWaitState', () => {
  it('blocks only the threads an observed episode affects, and notifies once per change', async () => {
    const { root, state } = await open()
    const waits = state()
    let notified = 0
    waits.subscribe(() => (notified += 1))
    expect(waits.blocked({ threadId: root })).toBe(false)

    await waits.observe({ threadId: root, waiting: waitingFor(root) })

    expect(waits.blocked({ threadId: root })).toBe(true)
    expect(waits.blocked({ threadId: 'other' as ThreadId })).toBe(false)
    expect(notified).toBeGreaterThan(0)
  })

  it('records 30 blocked children as one issue event on the root log', async () => {
    const { harness, root, state } = await open()
    const waits = state()
    const children = await Promise.all(
      Array.from({ length: 30 }, () =>
        harness.threads.create({ agent: { spawnedBy: root, type: 'builder' } }),
      ),
    )

    await Promise.all(
      children.map((child) => waits.observe({ threadId: child.id, waiting: waitingFor(child.id) })),
    )
    await Promise.all(
      children.map((child) => waits.observe({ threadId: child.id, waiting: waitingFor(child.id) })),
    )

    const events = await waitingEvents(harness, root)
    expect(events.length).toBeLessThanOrEqual(2)
    const [episode] = projectWaiting(events)
    expect(episode?.affectedThreadIds).toHaveLength(30)
    for (const child of children) expect(waits.blocked({ threadId: child.id })).toBe(true)
  })

  it('appends nothing for an unchanged episode observed again', async () => {
    const { harness, root, state } = await open()
    const waits = state()
    await waits.observe({ threadId: root, waiting: waitingFor(root) })
    const before = (await waitingEvents(harness, root)).length

    await waits.observe({ threadId: root, waiting: waitingFor(root) })

    expect((await waitingEvents(harness, root)).length).toBe(before)
  })

  it('records a changed reset time as a new observation of the same episode', async () => {
    const { harness, root, state } = await open()
    const waits = state()
    await waits.observe({ threadId: root, waiting: waitingFor(root) })
    await waits.observe({
      threadId: root,
      waiting: waitingFor(root, { until: '2026-11-02T00:00:00.000Z' }),
    })

    const projected = projectWaiting(await waitingEvents(harness, root))
    expect(projected).toHaveLength(1)
    expect(projected[0]?.resetAt).toBe('2026-11-02T00:00:00.000Z')
  })

  it('uses a null reason for a manual pause and the block until as resetAt otherwise', () => {
    const paused = waitingFor('t' as ThreadId, {
      availability: ECredentialAvailability.Paused,
    })
    expect(paused.reason).toBeNull()
    const quota = waitingFor('t' as ThreadId, {
      until: '2026-11-02T00:00:00.000Z',
    })
    expect(quota.reason).not.toBeNull()
    expect(quota.resetAt).toBe('2026-11-02T00:00:00.000Z')
  })

  it('clears only through an explicit clear, appending model-wait-cleared', async () => {
    const { harness, root, state } = await open()
    const waits = state()
    const waiting = waitingFor(root)
    await waits.observe({ threadId: root, waiting })
    await waits.open({ threadId: root })
    expect(waits.blocked({ threadId: root })).toBe(true)

    await waits.clear({ waiting })

    expect(waits.blocked({ threadId: root })).toBe(false)
    expect((await waitingEvents(harness, root)).at(-1)?.type).toBe('model-wait-cleared')
  })

  it('clears an episode when a thread is admitted again', async () => {
    const { root, state } = await open()
    const waits = state()
    await waits.observe({ threadId: root, waiting: waitingFor(root) })

    await waits.admitted({ threadId: root })

    expect(waits.blocked({ threadId: root })).toBe(false)
  })

  it('reconciles by clearing only eligible episodes', async () => {
    const { root, state } = await open()
    const waits = state()
    await waits.observe({ threadId: root, waiting: waitingFor(root) })
    await waits.reconcile({ eligible: async () => false })
    expect(waits.blocked({ threadId: root })).toBe(true)

    await waits.reconcile({ eligible: async () => true })
    expect(waits.blocked({ threadId: root })).toBe(false)
  })

  it('rebuilds the waiting set from the log on reopen, not component state', async () => {
    const { root, state } = await open()
    await state().observe({ threadId: root, waiting: waitingFor(root) })

    const reopened = state()
    expect(reopened.blocked({ threadId: root })).toBe(false)
    await reopened.open({ threadId: root })

    expect(reopened.blocked({ threadId: root })).toBe(true)
    expect(await reopened.episodeOf({ threadId: root })).toEqual(waitingFor(root).episode)
  })
})
