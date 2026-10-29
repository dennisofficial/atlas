import {
  EBootStep,
  EBootStepOutcome,
  EBootStepState,
  EVercelCredentialGap,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { seedThreadRow, seedUsers } from '../../../../test/session-seed'
import { readBootSteps, recordBootSteps } from './sandbox-boot-steps'

describe('boot step store', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedUsers('usr-1')
    await seedThreadRow({ id: 'thr-1', userId: 'usr-1' })
    await seedThreadRow({ id: 'thr-2', userId: 'usr-1' })
  })

  it('reads back the steps of one thread in the order they were recorded', async () => {
    const recorded = Array.from({ length: 40 }, (_, index) => ({
      step: EBootStep.Clone,
      state: EBootStepState.Running,
      error: `attempt ${index}`,
    }))
    await recordBootSteps({ threadId: 'thr-1', steps: recorded })
    await recordBootSteps({
      threadId: 'thr-2',
      steps: [{ step: EBootStep.Agent, state: EBootStepState.Done }],
    })

    const read = await readBootSteps({ threadId: 'thr-1' })

    expect(read.map((step) => step.error)).toEqual(recorded.map((step) => step.error))
  })

  it('keeps recording order across calls and carries error only when present', async () => {
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [{ step: EBootStep.Provision, state: EBootStepState.Running }],
    })
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [
        {
          step: EBootStep.Provision,
          state: EBootStepState.Error,
          error: 'boom',
        },
      ],
    })

    const read = await readBootSteps({ threadId: 'thr-1' })

    expect(read.map(({ step, state, error }) => ({ step, state, error }))).toEqual([
      {
        step: EBootStep.Provision,
        state: EBootStepState.Running,
        error: undefined,
      },
      { step: EBootStep.Provision, state: EBootStepState.Error, error: 'boom' },
    ])
    expect(read.every((step) => !Number.isNaN(Date.parse(step.at)))).toBe(true)
  })

  it('writes through the transaction it is handed', async () => {
    await expect(
      db.transaction(async (tx) => {
        await recordBootSteps({
          writer: tx,
          threadId: 'thr-1',
          steps: [{ step: EBootStep.Serve, state: EBootStepState.Running }],
        })
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')

    expect(await readBootSteps({ threadId: 'thr-1' })).toEqual([])
  })

  it('skips rows whose step or state is not part of the wire enums', async () => {
    await db.orm.public.SandboxBootStep.create({
      threadId: 'thr-1',
      step: 'legacy',
      state: 'done',
    })

    expect(await readBootSteps({ threadId: 'thr-1' })).toEqual([])
  })

  it('stores and reads back the credential gap of a step', async () => {
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [
        {
          step: EBootStep.Provision,
          state: EBootStepState.Error,
          error: 'no credential',
          gap: EVercelCredentialGap.UserCredential,
        },
        { step: EBootStep.Provision, state: EBootStepState.Running },
      ],
    })

    const read = await readBootSteps({ threadId: 'thr-1' })

    expect(read.map((step) => step.gap)).toEqual([EVercelCredentialGap.UserCredential, undefined])
  })

  it('reads back the outcome a step reported', async () => {
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [
        {
          step: EBootStep.Provision,
          state: EBootStepState.Done,
          outcome: EBootStepOutcome.Resumed,
        },
        { step: EBootStep.Clone, state: EBootStepState.Done },
      ],
    })

    const read = await readBootSteps({ threadId: 'thr-1' })

    expect(read.map((step) => step.outcome)).toEqual([EBootStepOutcome.Resumed, undefined])
  })
})
