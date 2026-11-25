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
import { FakeTool } from '@dltech/atlas-agent/testing'

import type { PrepareResult, PrepareStepReporter } from '../ports'
import { flushUntil, makeRig, seedSession, SESSION, THREAD_ID, type HolderRig } from './holder-rig'

const SETUP_SCRIPT = 'bun install'

const gate = (): { promise: Promise<PrepareResult>; settle(result: PrepareResult): void } => {
  let settle: (result: PrepareResult) => void = () => {}
  const promise = new Promise<PrepareResult>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

const seedWokenWorkspace = async (rig: HolderRig): Promise<void> => {
  const bodies: RecordEventBody[] = [
    {
      type: 'workspace-step',
      step: EWorkspaceStep.Setup,
      state: EWorkspaceStepState.Started,
      command: SETUP_SCRIPT,
    },
    {
      type: 'sandbox-setup-reported',
      text: `setup started in the background: ${SETUP_SCRIPT}`,
      failed: false,
      phase: ESetupPhase.Started,
    },
    { type: 'workspace-prepared' },
  ]
  const { epoch } = await rig.plane.grant({ sessionId: SESSION, hostId: 9001 })
  const outcome = await rig.plane.append({
    threadId: THREAD_ID,
    epoch,
    events: chainEvents({
      threadId: toThreadId(THREAD_ID),
      runId: toRunId('seed-run'),
      epoch,
      at: new Date(0).toISOString(),
      bodies,
      from: await rig.plane.head({ threadId: THREAD_ID }),
    }),
  })
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
  await rig.plane.revoke({ sessionId: SESSION, wantsHolder: false })
}

const typesOf = async (rig: HolderRig): Promise<string[]> =>
  (await rig.events()).map((event) => event.type)

const setupStepsOf = async (
  rig: HolderRig,
): Promise<{ state: string; reason: string | undefined }[]> => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 200,
    visible: false,
  })
  return page.events.flatMap((event) =>
    event.type === 'workspace-step' && event.step === EWorkspaceStep.Setup
      ? [{ state: event.state, reason: event.reason }]
      : [],
  )
}

const textOf = async (rig: HolderRig): Promise<string> => {
  const page = await rig.plane.readEvents({
    threadId: THREAD_ID,
    afterSeq: 0,
    limit: 200,
    visible: false,
  })
  return page.events
    .flatMap((event) =>
      event.type === 'tool-result' ? [event.modelText ?? '', event.error?.message ?? ''] : [],
    )
    .join('\n')
}

class PodFreeTool extends FakeTool {
  constructor() {
    super('task_write', 'written')
  }
}

describe('a message on a workspace that was prepared before', () => {
  it('starts the turn while the pod wakes again, and runs a pod-free tool first', async () => {
    const wake = gate()
    let started = 0
    const tool = new PodFreeTool()
    const rig = await makeRig({
      prepare: async (onStep?: PrepareStepReporter) => {
        started += 1
        void onStep
        return await wake.promise
      },
      hostTools: [tool],
      script: [
        { calls: [{ callId: 'call-1', name: 'task_write', input: { path: 'notes.md' } }] },
        { text: 'wrote the note' },
      ],
    })
    await seedSession(rig)
    await seedWokenWorkspace(rig)
    await rig.post('write it')
    await rig.holder.start()
    await rig.wake()

    const answered = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
      attempts: 200,
    })
    expect(answered).toBe(true)
    expect(started).toBe(1)
    expect(tool.invocations).toHaveLength(1)
    const types = await typesOf(rig)
    expect(types.indexOf('turn-started')).toBeLessThan(types.indexOf('assistant-said'))
    expect(types.filter((type) => type === 'workspace-prepared')).toHaveLength(1)
    expect(types).not.toContain('workspace-prepare-failed')

    wake.settle({ ok: true })
    await rig.flush()
    expect((await typesOf(rig)).filter((type) => type === 'workspace-prepared')).toHaveLength(1)
    rig.holder.discard()
  }, 15_000)

  it('fails a pod call with the wake reason and keeps the turn going', async () => {
    const rig = await makeRig({
      prepare: async () => ({ ok: false, reason: 'the sandbox did not wake' }),
      script: [
        { calls: [{ callId: 'call-1', name: 'bash', input: { command: 'echo one' } }] },
        { text: 'the pod is not up' },
      ],
    })
    await seedSession(rig)
    await seedWokenWorkspace(rig)
    await rig.post('run it')
    await rig.holder.start()
    await rig.wake()

    const answered = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
      attempts: 200,
    })
    expect(answered).toBe(true)
    expect(await textOf(rig)).toContain('the workspace failed to prepare: the sandbox did not wake')
    expect(rig.runtimes[0]?.stopped).toBe(false)
    expect((await typesOf(rig)).filter((type) => type === 'workspace-prepared')).toHaveLength(1)
    rig.holder.discard()
  }, 15_000)

  it('ends a setup it could not re-join, releases the pod, and takes the next message', async () => {
    let attempts = 0
    const rig = await makeRig({
      prepare: async () => {
        attempts += 1
        return attempts === 1 ? { ok: false, reason: 'the sandbox did not wake' } : { ok: true }
      },
      script: [{ text: 'the pod is not up' }, { text: 'ran it' }],
    })
    await seedSession(rig)
    await seedWokenWorkspace(rig)
    await rig.post('run it')
    await rig.holder.start()
    await rig.wake()

    const answered = await flushUntil({
      check: async () => (await typesOf(rig)).includes('assistant-said'),
      attempts: 200,
    })
    expect(answered).toBe(true)
    expect(await setupStepsOf(rig)).toEqual([
      { state: EWorkspaceStepState.Started, reason: undefined },
      {
        state: EWorkspaceStepState.Interrupted,
        reason:
          'the setup was lost when the workspace could not be prepared again: the sandbox did not wake',
      },
    ])

    const released = await flushUntil({
      check: async () => rig.runtimes[0]?.released === true,
      attempts: 200,
    })
    expect(released).toBe(true)
    expect(rig.holder.heldIds()).toEqual([])

    await rig.post('try again')
    await rig.wake()
    const again = await flushUntil({
      check: async () =>
        (await typesOf(rig)).filter((type) => type === 'assistant-said').length === 2,
      attempts: 200,
    })
    expect(again).toBe(true)
    rig.holder.discard()
  }, 15_000)

  it('aborts the turn on a stop and lets the wake finish without a failure', async () => {
    const wake = gate()
    const rig = await makeRig({
      prepare: async () => await wake.promise,
      script: [
        { calls: [{ callId: 'call-1', name: 'bash', input: { command: 'echo one' } }] },
        { text: 'ran it' },
      ],
    })
    await seedSession(rig)
    await seedWokenWorkspace(rig)
    await rig.post('run it')
    await rig.holder.start()
    await rig.wake()
    const dispatched = await flushUntil({
      check: async () => (await typesOf(rig)).includes('tool-dispatched'),
      attempts: 200,
    })
    expect(dispatched).toBe(true)

    await rig.postStop()
    await rig.wake()
    await rig.flush()
    expect(await typesOf(rig)).not.toContain('assistant-said')

    wake.settle({ ok: true })
    await rig.flush()
    const types = await typesOf(rig)
    expect(types).not.toContain('workspace-prepare-failed')
    expect(types.filter((type) => type === 'workspace-prepared')).toHaveLength(1)
    rig.holder.discard()
  }, 15_000)
})
