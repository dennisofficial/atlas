import { describe, expect, it, mock } from 'bun:test'
import { chainEvents, toRunId, toThreadId, type V2Body } from '@dltech/atlas-core'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { composedControlPlaneOver } from '@dltech/atlas-pods'
import { triggerSdkFake } from './trigger-sdk.fake'
import { routineRowOf } from './routine-graph.fake'

mock.module('@trigger.dev/sdk', () => triggerSdkFake)

const { runRoutineOnce } = await import('../trigger/routine/routine-run.task')
const { routineGraphOver } = await import('../trigger/routine/routine-graph')

const LAST_SESSION = 'ses-last'
const LAST_THREAD = 'thr-last'
const AT = '2026-11-16T12:02:47.854Z'

const mcpServerChanged = {
  type: 'mcp-server-changed',
  row: { layer: 'user', name: 'wispr-flow', status: 'connected', toolCount: 16, transport: 'http' },
} as V2Body

const seedLastSessionWithPluginEvent = async (store: InMemoryControlStore): Promise<void> => {
  const plane = composedControlPlaneOver({ store })
  await plane.createSession({
    sessionId: LAST_SESSION,
    userId: 'usr_1',
    projectId: 'prj_1',
    mainThreadId: LAST_THREAD,
  })
  const lease = await plane.grant({ sessionId: LAST_SESSION, hostId: 1 })
  const head = await plane.head({ threadId: LAST_THREAD })
  const events = chainEvents({
    threadId: toThreadId(LAST_THREAD),
    runId: toRunId('run-1'),
    epoch: lease.epoch,
    at: AT,
    bodies: [{ type: 'user-said', text: 'prep the L10' }, mcpServerChanged],
    from: head,
  })
  const outcome = await plane.append({ threadId: LAST_THREAD, epoch: lease.epoch, events })
  if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
  await plane.revoke({ sessionId: LAST_SESSION, wantsHolder: false })
}

const staleTheView = async (store: InMemoryControlStore): Promise<void> => {
  await store.transact((tx) =>
    tx.writeSessionView({
      sessionId: LAST_SESSION,
      threadId: LAST_THREAD,
      atSeq: 0,
      version: 0,
      state: 'x',
    }),
  )
}

describe('a scheduled routine whose last session holds a plugin event', () => {
  it('starts a new session after a view version bump forces a rebuild of the last one', async () => {
    const store = new InMemoryControlStore()
    await seedLastSessionWithPluginEvent(store)
    await staleTheView(store)
    await store.transact((tx) =>
      tx.insertRoutine(
        routineRowOf({
          cron: '0 7 * * 1',
          timezone: 'America/New_York',
          nextRunAt: '2026-11-23T12:00:00.000Z',
          lastSessionId: LAST_SESSION,
        }),
      ),
    )

    const result = await runRoutineOnce({
      graph: routineGraphOver(store),
      payload: { routineId: 'rtn_1', scheduledFor: '2026-11-23T12:00:00.000Z' },
      now: '2026-11-23T12:01:29.000Z',
    })

    expect(result.outcome).toBe('started')
    expect(result.sessionId).toBeDefined()
  })
})
