import { describe, expect, it } from 'bun:test'
import {
  chainEvents,
  ESetupPhase,
  EWorkspaceStep,
  EWorkspaceStepState,
  toRunId,
  toThreadId,
  type RecordEventBody,
} from '@dltech/atlas-core'

import type { PrepareStepReporter, SetupLifecycle } from '../ports'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID } from './holder-rig'

const SETUP_SCRIPT = 'bun install'

const replayingSetup = () => {
  const reported: SetupLifecycle[] = []
  const listeners: ((lifecycle: SetupLifecycle) => void)[] = []
  return {
    subscribe: (listener: (lifecycle: SetupLifecycle) => void): void => {
      listeners.push(listener)
      for (const lifecycle of reported) listener(lifecycle)
    },
    started: (script: string): void => {
      const lifecycle: SetupLifecycle = { phase: ESetupPhase.Started, script }
      reported.push(lifecycle)
      for (const listener of listeners) listener(lifecycle)
    },
    finished: (script: string): void => {
      const lifecycle: SetupLifecycle = {
        phase: ESetupPhase.Finished,
        script,
        ok: true,
        durationMs: 1_200,
        output: 'installed 412 packages',
      }
      reported.push(lifecycle)
      for (const listener of listeners) listener(lifecycle)
    },
  }
}

const noticePhases = async (rig: Awaited<ReturnType<typeof makeRig>>): Promise<ESetupPhase[]> => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 100,
    visible: false,
  })
  return page.events.flatMap((event) =>
    event.type === 'sandbox-setup-reported' && event.phase !== undefined ? [event.phase] : [],
  )
}

const seedRunningSetup = async (
  rig: Awaited<ReturnType<typeof makeRig>>,
  args: { reported: boolean },
): Promise<void> => {
  const startedStep: RecordEventBody = {
    type: 'workspace-step',
    step: EWorkspaceStep.Setup,
    state: EWorkspaceStepState.Started,
    command: SETUP_SCRIPT,
  }
  const startedNotice: RecordEventBody = {
    type: 'sandbox-setup-reported',
    text: `setup started in the background: ${SETUP_SCRIPT}`,
    failed: false,
    phase: ESetupPhase.Started,
  }
  const { epoch } = await rig.plane.grant({ sessionId: SESSION, hostId: 9001 })
  const outcome = await rig.plane.append({
    threadId: THREAD_ID,
    epoch,
    events: chainEvents({
      threadId: toThreadId(THREAD_ID),
      runId: toRunId('seed-run'),
      epoch,
      at: new Date(0).toISOString(),
      bodies: args.reported ? [startedStep, startedNotice] : [startedStep],
      from: await rig.plane.head({ threadId: THREAD_ID }),
    }),
  })
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
  await rig.plane.revoke({ sessionId: SESSION, wantsHolder: false })
}

const takeoverRig = async (args: {
  reported: boolean
  setup: ReturnType<typeof replayingSetup>
}) => {
  const attempt = { count: 0, report: undefined as PrepareStepReporter | undefined }
  const rig = await makeRig({
    subscribeSetup: args.setup.subscribe,
    prepare: async (onStep) => {
      attempt.count += 1
      attempt.report = onStep
      return { ok: true }
    },
  })
  await seedSession(rig)
  await seedRunningSetup(rig, { reported: args.reported })
  await rig.holder.start()
  await rig.wake()
  await flushUntil({ check: async () => attempt.count === 1 })
  expect(attempt.count).toBe(1)
  return { rig, attempt }
}

describe('a setup that ends before the workspace was recorded as prepared', () => {
  it('reports each lifecycle once when the reconciler prepares again and replays it', async () => {
    const setup = replayingSetup()
    setup.started(SETUP_SCRIPT)
    const { rig, attempt } = await takeoverRig({ reported: true, setup })

    attempt.report?.({
      step: EWorkspaceStep.Setup,
      state: EWorkspaceStepState.Done,
      command: SETUP_SCRIPT,
      output: 'installed 412 packages',
    })
    setup.finished(SETUP_SCRIPT)
    const prepared = await flushUntil({
      check: async () => (await noticePhases(rig)).includes(ESetupPhase.Finished),
    })
    expect(prepared).toBe(true)
    await rig.flush()

    expect(attempt.count).toBe(2)
    expect(await noticePhases(rig)).toEqual([ESetupPhase.Started, ESetupPhase.Finished])
    rig.holder.discard()
  })

  it('records the start a host that died before reporting it never wrote', async () => {
    const setup = replayingSetup()
    setup.started(SETUP_SCRIPT)
    const { rig, attempt } = await takeoverRig({ reported: false, setup })

    const started = await flushUntil({
      check: async () => (await noticePhases(rig)).includes(ESetupPhase.Started),
    })
    expect(started).toBe(true)
    expect(await noticePhases(rig)).toEqual([ESetupPhase.Started])

    attempt.report?.({
      step: EWorkspaceStep.Setup,
      state: EWorkspaceStepState.Done,
      command: SETUP_SCRIPT,
      output: 'installed 412 packages',
    })
    setup.finished(SETUP_SCRIPT)
    const reported = await flushUntil({
      check: async () => (await noticePhases(rig)).includes(ESetupPhase.Finished),
    })
    expect(reported).toBe(true)
    await rig.flush()

    expect(await noticePhases(rig)).toEqual([ESetupPhase.Started, ESetupPhase.Finished])
    rig.holder.discard()
  })
})
