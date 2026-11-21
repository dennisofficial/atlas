import { describe, expect, it } from 'bun:test'

import { EWorkspaceStep, EWorkspaceStepState } from '@dltech/atlas-core'

import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const recordedEvents = async (rig: Awaited<ReturnType<typeof makeRig>>) =>
  (await rig.plane.readEvents({ threadId: THREAD_ID, afterSeq: 0, limit: 200, visible: false }))
    .events

const attemptsOf = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<number[]> => {
  const events = await recordedEvents(rig)
  return events.flatMap((event) =>
    event.type === 'workspace-attempt-started' ? [event.attempt] : [],
  )
}

const stepAttemptsOf = async (
  rig: Awaited<ReturnType<typeof makeRig>>,
  step: EWorkspaceStep,
): Promise<(number | undefined)[]> =>
  (await recordedEvents(rig)).flatMap((event) =>
    event.type === 'workspace-step' && event.step === step ? [event.attempt] : [],
  )

const failureAttemptsOf = async (
  rig: Awaited<ReturnType<typeof makeRig>>,
): Promise<(number | undefined)[]> =>
  (await recordedEvents(rig)).flatMap((event) =>
    event.type === 'workspace-prepare-failed' ? [event.attempt] : [],
  )

describe('prepare attempts', () => {
  it('records the attempt before the first step of a prepare', async () => {
    const rig = await makeRig({
      prepare: async (onStep) => {
        onStep?.({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Done })
        return { ok: false, reason: 'no sandbox' }
      },
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.wake()
    const failed = await flushUntil({
      check: async () =>
        (await recordedEvents(rig)).some((event) => event.type === 'workspace-prepare-failed'),
    })
    expect(failed).toBe(true)
    expect((await recordedEvents(rig)).map((event) => event.type)).toEqual([
      'workspace-attempt-started',
      'workspace-step',
      'workspace-prepare-failed',
    ])
    expect(await attemptsOf(rig)).toEqual([1])
    expect(await stepAttemptsOf(rig, EWorkspaceStep.Sandbox)).toEqual([1])
    expect(await failureAttemptsOf(rig)).toEqual([1])
  })

  it('numbers a retry from the durable log rather than from host memory', async () => {
    let prepares = 0
    const rig = await makeRig({
      prepare: async (onStep) => {
        prepares += 1
        onStep?.({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Started })
        if (prepares === 1) return { ok: false, reason: 'no sandbox' }
        onStep?.({ step: EWorkspaceStep.Sandbox, state: EWorkspaceStepState.Done })
        return { ok: true }
      },
    })
    await seedSession(rig)
    await rig.holder.start()
    await rig.wake()
    await flushUntil({
      check: async () =>
        (await recordedEvents(rig)).some((event) => event.type === 'workspace-prepare-failed'),
    })
    await rig.plane.post({ sessionId: SESSION, kind: 'retry', payload: '{}' })
    await rig.wake()
    const prepared = await flushUntil({
      check: async () =>
        (await recordedEvents(rig)).some((event) => event.type === 'workspace-prepared'),
    })
    expect(prepared).toBe(true)
    expect(await attemptsOf(rig)).toEqual([1, 2])
    expect(await stepAttemptsOf(rig, EWorkspaceStep.Sandbox)).toEqual([1, 2, 2])
  })
})
