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
import { podSessionOf } from '../sessions/session-of-thread'
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
      sessionId: 'ses_thr-1',
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

  it('round-trips the per-repo clone progress of a step', async () => {
    const repos = [
      { repo: 'acme/api', state: EBootStepState.Done },
      { repo: 'acme/web', state: EBootStepState.Error, error: 'not found' },
    ]
    await recordBootSteps({
      threadId: 'thr-1',
      steps: [
        { step: EBootStep.Clone, state: EBootStepState.Done, repos },
        { step: EBootStep.Settings, state: EBootStepState.Done },
      ],
    })

    const read = await readBootSteps({ threadId: 'thr-1' })

    expect(read.map((step) => step.repos)).toEqual([repos, undefined])
  })

  it('drops stored repos that do not parse as clone progress', async () => {
    await db.orm.public.SandboxBootStep.create({
      sessionId: 'ses_thr-1',
      step: EBootStep.Clone,
      state: EBootStepState.Done,
      repos: [{ nope: true }],
    })

    const read = await readBootSteps({ threadId: 'thr-1' })

    expect(read.map((step) => step.repos)).toEqual([undefined])
  })

  it('orders one batch and the batches after it strictly', async () => {
    const batch = (prefix: string) =>
      Array.from({ length: 5 }, (_, index) => ({
        step: EBootStep.Clone,
        state: EBootStepState.Running,
        error: `${prefix}${index}`,
      }))
    await recordBootSteps({ threadId: 'thr-1', steps: batch('a') })
    await recordBootSteps({ threadId: 'thr-1', steps: batch('b') })

    const read = await readBootSteps({ threadId: 'thr-1' })

    expect(read.map((step) => step.error)).toEqual(
      [...batch('a'), ...batch('b')].map((s) => s.error),
    )
  })

  it('reads batches back in insertion order when their clocks disagree', async () => {
    const sessionId = await podSessionOf({ reader: db, threadId: 'thr-1' })
    const rowAt = (error: string, at: Date) => ({
      sessionId,
      step: EBootStep.Clone,
      state: EBootStepState.Running,
      error,
      gap: null,
      outcome: null,
      repos: null,
      at,
    })
    await db.orm.public.SandboxBootStep.createAll([
      rowAt('first', new Date('2026-10-30T12:00:05.000Z')),
      rowAt('second', new Date('2026-10-30T12:00:01.000Z')),
    ])
    await db.orm.public.SandboxBootStep.createAll([
      rowAt('third', new Date('2026-10-30T12:00:03.000Z')),
      rowAt('fourth', new Date('2026-10-30T12:00:03.000Z')),
    ])

    const read = await readBootSteps({ threadId: 'thr-1' })

    expect(read.map((step) => step.error)).toEqual(['first', 'second', 'third', 'fourth'])
  })
})
