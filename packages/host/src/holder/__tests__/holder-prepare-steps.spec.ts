import { describe, expect, it } from 'bun:test'

import { EWorkspaceStep, EWorkspaceStepState } from '@dltech/atlas-core'
import { setupOutputCallId } from '@dltech/atlas-protocol'

import { flushUntil, makeRig, SESSION, seedSession, THREAD_ID } from './holder-rig'

const typesOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<string[]> =>
  (await rig.events()).map((event) => event.type)

describe('SessionHolder prepare steps', () => {
  it('records each reported step in order, then the final event', async () => {
    const rig = await makeRig({
      prepare: async (onStep) => {
        onStep?.({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Started })
        onStep?.({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Done })
        onStep?.({ step: EWorkspaceStep.Daemon, state: EWorkspaceStepState.Done })
        return { ok: true }
      },
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.wake()
    const prepared = await flushUntil({
      check: async () => (await typesOf(rig)).includes('workspace-prepared'),
    })
    expect(prepared).toBe(true)
    expect(await typesOf(rig)).toEqual([
      'workspace-step',
      'workspace-step',
      'workspace-step',
      'workspace-prepared',
    ])
    const events = await rig.plane.readEvents({
      threadId: THREAD_ID,
      afterSeq: 0,
      limit: 10,
      visible: false,
    })
    const labels: string[] = events.events.map((event) =>
      event.type === 'workspace-step' ? event.step : event.type,
    )
    expect(labels).toEqual(['sandbox', 'sandbox', 'daemon', 'workspace-prepared'])
  })

  it('records the failed step before the failure', async () => {
    const rig = await makeRig({
      prepare: async (onStep) => {
        onStep?.({
          step: EWorkspaceStep.Clone,
          state: EWorkspaceStepState.Failed,
          reason: 'clone failed',
        })
        return { ok: false, reason: 'clone failed' }
      },
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.wake()
    await flushUntil({
      check: async () => (await typesOf(rig)).includes('workspace-prepare-failed'),
    })
    expect(await typesOf(rig)).toEqual(['workspace-step', 'workspace-prepare-failed'])
  })
})

describe('SessionHolder setup output', () => {
  it('forwards runtime prepare output as setup tool-output live frames', async () => {
    let emit: (text: string) => void = () => {}
    const rig = await makeRig({
      subscribePrepareOutput: (listener) => {
        emit = listener
      },
      prepare: async () => {
        emit('installing\n')
        return { ok: true }
      },
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.wake()
    await flushUntil({ check: async () => (await typesOf(rig)).includes('workspace-prepared') })
    expect(rig.bus.frames.map((entry) => entry.frame)).toContainEqual({
      type: 'tool-output',
      callId: setupOutputCallId(SESSION),
      text: 'installing\n',
    })
  })
})
