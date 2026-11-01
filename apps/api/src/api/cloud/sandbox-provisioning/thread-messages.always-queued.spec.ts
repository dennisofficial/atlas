import { EBootStep, EBootStepState, ERuntimePhase, EThreadMessageState } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { recordBootSteps } from '../../platform/sandboxes/sandbox-boot-steps'
import { SANDBOX_BUSY_MESSAGE } from './sandbox-provisioning-rows'
import {
  appendRaw,
  checkpointOf,
  eventsOf,
  messagesWith,
  sandboxRows,
  seedProvisionedRow,
  seedThread,
} from './sandbox-provisioning.fixture'

const ARGS = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1', text: 'hello' } as const
const SERVE_URL = 'https://serve.example.test'

const parked = () =>
  seedProvisionedRow({
    state: 'parked',
    wakeClaim: null,
    runtimeCheckpoint: checkpointOf(ERuntimePhase.Parked),
  })

const failed = () => seedProvisionedRow({ wakeClaim: null, wakeFailedAt: new Date() })

const booting = () => seedProvisionedRow()

const running = (agent: EBootStepState | null) => async () => {
  await seedProvisionedRow({ state: 'running', wakeClaim: null, serveUrl: SERVE_URL })
  if (agent === null) return
  await recordBootSteps({ threadId: 'thr-1', steps: [{ step: EBootStep.Agent, state: agent }] })
}

describe('ThreadMessagesService.send by pod state', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedThread()
  })

  it('appends one user-said event, claims the row and dispatches once when no sandbox row exists', async () => {
    const { service, dispatch } = messagesWith()

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    const events = await eventsOf()
    expect(events.map((event) => [event.seq, event.type])).toEqual([[1, 'user-said']])
    expect(JSON.parse(events[0]?.body ?? '').requestId).toBe('snd-1')
    const [row] = await sandboxRows()
    expect(row?.wakeClaim).not.toBeNull()
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a parked pod', parked, 1],
    ['a failed pod', failed, 1],
    ['a pod booting under an active claim', booting, 0],
  ])(
    'appends once, idempotent on sendId, for %s (dispatches: %s)',
    async (_state, seed, dispatched) => {
      await seed()
      const { service, dispatch } = messagesWith()

      expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })
      expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

      const events = await eventsOf()
      expect(events.map((event) => [event.seq, event.type])).toEqual([[1, 'user-said']])
      expect(JSON.parse(events[0]?.body ?? '').requestId).toBe('snd-1')
      expect(dispatch).toHaveBeenCalledTimes(dispatched)
    },
  )

  it.each([
    ['parked', parked],
    ['failed', failed],
  ])('claims a %s row inside the send and clears its failure', async (_state, seed) => {
    await seed()
    const { service } = messagesWith()

    await service.send(ARGS)

    const [row] = await sandboxRows()
    expect(row?.wakeClaim).not.toBeNull()
    expect(row?.state).toBe('resuming')
  })

  it('does not dispatch again for a second message while the pod boots', async () => {
    await parked()
    const { service, dispatch } = messagesWith()

    await service.send(ARGS)
    expect(await service.send({ ...ARGS, sendId: 'snd-2', text: 'more' })).toEqual({
      state: EThreadMessageState.Queued,
    })

    expect((await eventsOf()).map((event) => event.seq)).toEqual([1, 2])
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the agent has not started', running(null)],
    ['the agent is running', running(EBootStepState.Running)],
    ['the agent step is done', running(EBootStepState.Done)],
  ])('appends and answers Queued to a running pod when %s, claiming nothing', async (_n, seed) => {
    await seed()
    const { service, dispatch } = messagesWith()

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    const events = await eventsOf()
    expect(events.map((event) => [event.seq, event.type])).toEqual([[1, 'user-said']])
    expect(dispatch).not.toHaveBeenCalled()
    expect((await sandboxRows())[0]?.wakeClaim).toBeNull()
  })

  it.each([
    ['the agent has not started', running(null)],
    ['the agent is running', running(EBootStepState.Running)],
  ])(
    'answers Queued without appending or dispatching a sendId already stored, when %s',
    async (_n, seed) => {
      await seed()
      await appendRaw({
        type: 'user-said',
        body: JSON.stringify({ type: 'user-said', text: 'hello', requestId: 'snd-1' }),
      })
      const { service, dispatch } = messagesWith()

      expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

      expect(await eventsOf()).toHaveLength(1)
      expect(dispatch).not.toHaveBeenCalled()
      expect((await sandboxRows())[0]?.wakeClaim).toBeNull()
    },
  )

  it('answers Queued to a retried sendId right after its own fresh claim', async () => {
    const { service, dispatch } = messagesWith()

    await service.send(ARGS)
    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    expect(await eventsOf()).toHaveLength(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
