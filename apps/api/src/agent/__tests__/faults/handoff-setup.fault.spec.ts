import { EWorkspaceStep, EWorkspaceStepState } from '@dltech/atlas-core'
import { expect } from 'bun:test'

import { SETUP_INTERRUPTED_REASON } from '../../runtime/workspace-setup'
import {
  describeHandoff,
  POD_EFFECT_WAIT_MS,
  waitUntil,
  type HandoffContext,
} from '../../testing/handoff-suite'
import type { HostProcess } from '../../testing/fault-rig'

const SETUP_SCRIPT = 'touch started; echo run >> runs; cat gate; echo end'

type Step = { step: string; state: string; reason?: string; command?: string; output?: string }

const setupStepsOf = async (ctx: HandoffContext): Promise<Step[]> =>
  (await ctx.record())
    .filter((row) => row.type === 'workspace-step')
    .map((row) => row.event as Step)
    .filter((step) => step.step === EWorkspaceStep.Setup)

const setupNoticePhasesOf = async (ctx: HandoffContext): Promise<string[]> =>
  (await ctx.record())
    .filter((row) => row.type === 'sandbox-setup-reported')
    .map((row) => (row.event as { phase?: string }).phase)
    .filter((phase): phase is string => phase !== undefined)

const startedCount = (steps: readonly Step[]): number =>
  steps.filter((step) => step.state === EWorkspaceStepState.Started).length

const expectRunning = async (ctx: HandoffContext): Promise<void> => {
  const steps = await setupStepsOf(ctx)
  expect(startedCount(steps)).toBe(1)
  expect(steps.filter((step) => step.state === EWorkspaceStepState.Done)).toHaveLength(0)
  expect(steps.filter((step) => step.state === EWorkspaceStepState.Failed)).toHaveLength(0)
}

describeHandoff({
  name: 'a setup script that runs in the background',
  prompt: 'say hello',
  prepared: false,
  setupScript: SETUP_SCRIPT,

  async start(ctx): Promise<HostProcess> {
    ctx.path('started')
    ctx.path('runs')
    ctx.gate('gate')
    const hostA = await ctx.rig.spawnHost({
      label: 'host-a',
      daemonUrl: ctx.daemon.url,
      workspace: ctx.workspace,
      scripts: { [ctx.sessionId]: [{ text: 'host a started the setup' }] },
      setupScript: SETUP_SCRIPT,
    })
    await ctx.rig.claim({ sessionId: ctx.sessionId, label: 'host-a', timeoutMs: 30_000 })
    await ctx.waitFor('started', POD_EFFECT_WAIT_MS)
    await waitUntil({
      what: 'the setup script to be recorded as started',
      check: async () => startedCount(await setupStepsOf(ctx)) === 1,
      timeoutMs: POD_EFFECT_WAIT_MS,
    })
    await expectRunning(ctx)
    return hostA
  },

  async inFlight(ctx) {
    await expectRunning(ctx)
  },

  async release(ctx) {
    await ctx.release('gate')
  },

  async settled(ctx) {
    await waitUntil({
      what: 'the setup script to report its end',
      check: async () =>
        (await setupStepsOf(ctx)).some((step) => step.state === EWorkspaceStepState.Done),
      timeoutMs: POD_EFFECT_WAIT_MS,
    })
    const steps = await setupStepsOf(ctx)
    expect(startedCount(steps)).toBe(1)
    expect(steps.filter((step) => step.state === EWorkspaceStepState.Failed)).toHaveLength(0)
    const done = steps.filter((step) => step.state === EWorkspaceStepState.Done)
    expect(done).toHaveLength(1)
    expect(done[0]?.command).toBe(SETUP_SCRIPT)
    expect(done[0]?.output).toContain('end')
    await waitUntil({
      what: 'the setup finished notice',
      check: async () => (await setupNoticePhasesOf(ctx)).includes('finished'),
      timeoutMs: POD_EFFECT_WAIT_MS,
    })
    expect(await setupNoticePhasesOf(ctx)).toEqual(['started', 'finished'])
  },

  async runs(ctx) {
    return ctx.runCount('runs')
  },

  async interrupted(ctx) {
    await waitUntil({
      what: 'the setup script to be reported interrupted',
      check: async () =>
        (await setupStepsOf(ctx)).some((step) => step.state === EWorkspaceStepState.Interrupted),
      timeoutMs: POD_EFFECT_WAIT_MS,
    })
    const steps = await setupStepsOf(ctx)
    expect(startedCount(steps)).toBe(1)
    expect(steps.filter((step) => step.state === EWorkspaceStepState.Done)).toHaveLength(0)
    expect(steps.filter((step) => step.state === EWorkspaceStepState.Interrupted)).toEqual([
      expect.objectContaining({ reason: SETUP_INTERRUPTED_REASON }),
    ])
  },
})
