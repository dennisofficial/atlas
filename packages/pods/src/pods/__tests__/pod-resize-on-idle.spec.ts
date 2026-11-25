import { describe, expect, it } from 'bun:test'
import type { ControlSessionRow, ControlTx } from '@dltech/atlas-control'
import { initialSessionViewState, type SessionViewState } from '@dltech/atlas-core'
import type { PodResizePayload } from '@dltech/atlas-jobs/pod-resize'

import { podResizeOnIdleHook } from '../pod-resize-on-idle'

const NOW = '2026-11-25T12:00:00.000Z'
const WAITED = '2026-11-25T11:00:00.000Z'

const shell = (status: 'running' | 'exited') => ({
  shellId: 'sh-1',
  name: 'dev',
  command: 'bun dev',
  status,
  characters: 0,
  awaitingInput: false,
  changedAt: NOW,
})

const withShell = (status: 'running' | 'exited'): SessionViewState => ({
  ...initialSessionViewState,
  pluginViews: { shells: [shell(status)] },
})

const rowOf = (over: Partial<ControlSessionRow>): ControlSessionRow =>
  ({
    sessionId: 'pod-a',
    podSizeGeneration: 4,
    podWaitingSince: WAITED,
    podDesiredVcpus: 8,
    podDesiredMemoryGb: 32,
    podDesiredDiskGb: null,
    ...over,
  }) as ControlSessionRow

const rigOf = (args: { row?: ControlSessionRow | undefined; failDispatch?: boolean }) => {
  const dispatched: { payload: PodResizePayload; idempotencyKey: string }[] = []
  const locked: string[] = []
  const warnings: string[] = []
  const tx = {
    lockSession: async (sessionId: string) => {
      locked.push(sessionId)
      return args.row
    },
  } as unknown as ControlTx
  const hook = podResizeOnIdleHook({
    dispatch: async (dispatch) => {
      if (args.failDispatch === true) throw new Error('trigger.dev is down')
      dispatched.push(dispatch)
    },
    warn: ({ sessionId }) => warnings.push(sessionId),
  })
  const run = (states: { before: SessionViewState; after: SessionViewState }) =>
    hook.handle({ tx, sessionId: 'pod-a', now: NOW, ...states })
  return { run, dispatched, locked, warnings }
}

describe('podResizeOnIdleHook', () => {
  it('dispatches the waiting resize once, keyed by its wait, when the last shell ends', async () => {
    const { run, dispatched } = rigOf({ row: rowOf({}) })

    await run({ before: withShell('running'), after: withShell('exited') })

    expect(dispatched).toEqual([
      {
        payload: {
          sessionId: 'pod-a',
          generation: 4,
          vcpus: 8,
          memoryGb: 32,
          whenIdle: true,
          waitedSince: WAITED,
        },
        idempotencyKey: `pod-resize:pod-a:4:idle:${WAITED}`,
      },
    ])
  })

  it('carries the disk the waiting resize asked for', async () => {
    const { run, dispatched } = rigOf({ row: rowOf({ podDesiredDiskGb: 40 }) })

    await run({ before: withShell('running'), after: withShell('exited') })

    expect(dispatched[0]?.payload.diskGb).toBe(40)
  })

  it('reads no session row while the pod stays busy or stays idle', async () => {
    const { run, dispatched, locked } = rigOf({ row: rowOf({}) })

    await run({ before: withShell('running'), after: withShell('running') })
    await run({ before: withShell('exited'), after: withShell('exited') })

    expect(locked).toEqual([])
    expect(dispatched).toEqual([])
  })

  it('dispatches nothing when no resize waits', async () => {
    const { run, dispatched, locked } = rigOf({ row: rowOf({ podWaitingSince: null }) })

    await run({ before: withShell('running'), after: withShell('exited') })

    expect(locked).toEqual(['pod-a'])
    expect(dispatched).toEqual([])
  })

  it('keeps the append when the dispatch fails, and warns', async () => {
    const { run, warnings } = rigOf({ row: rowOf({}), failDispatch: true })

    await run({ before: withShell('running'), after: withShell('exited') })

    expect(warnings).toEqual(['pod-a'])
  })
})
