import { ERuntimePhase, EThreadMessageState } from '@dltech/atlas-wire'
import { useTestDatabase } from '@dltech/atlas-db/testing'
import { beforeEach, describe, expect, it } from 'bun:test'
import { NOT_RUNNING_MESSAGE, SANDBOX_BUSY_MESSAGE } from './sandbox-provisioning-rows'
import {
  checkpointOf,
  eventsOf,
  messagesWith,
  sandboxRows,
  seedProvisionedRow,
  seedSandboxRow,
  seedThread,
} from './sandbox-provisioning.fixture'

const ARGS = { userId: 'usr-1', threadId: 'thr-1', sendId: 'snd-1', text: 'hello' } as const
const SERVE_URL = 'https://serve.example.test'

describe('ThreadMessagesService.send while the pod cannot take a message yet', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedThread()
  })

  it('appends and answers Queued for a running pod mid-parking checkpoint, claiming nothing', async () => {
    await seedProvisionedRow({
      state: 'running',
      wakeClaim: null,
      serveUrl: SERVE_URL,
      runtimeCheckpoint: checkpointOf(ERuntimePhase.Parking),
    })
    const { service, dispatch } = messagesWith()

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    expect(await eventsOf()).toHaveLength(1)
    expect(dispatch).not.toHaveBeenCalled()
    expect((await sandboxRows())[0]?.wakeClaim).toBeNull()
  })

  it('answers 409 when the pod is parking and no longer reports a serve url', async () => {
    await seedProvisionedRow({
      state: 'parked',
      wakeClaim: null,
      runtimeCheckpoint: checkpointOf(ERuntimePhase.Parking),
    })
    const { service, dispatch } = messagesWith()

    await expect(service.send(ARGS)).rejects.toMatchObject({ status: 409 })

    expect(await eventsOf()).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('appends and wakes a pod whose parked checkpoint is final', async () => {
    await seedProvisionedRow({
      state: 'parked',
      wakeClaim: null,
      runtimeCheckpoint: checkpointOf(ERuntimePhase.Parked),
    })
    const { service, dispatch } = messagesWith()

    expect(await service.send(ARGS)).toEqual({ state: EThreadMessageState.Queued })

    expect(await eventsOf()).toHaveLength(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})

describe('ThreadMessagesService.send on a TUI-provisioned thread', () => {
  useTestDatabase()

  beforeEach(async () => {
    await seedThread()
  })

  it.each([
    ['parked', { state: 'parked', wakeClaim: null }],
    ['failed', { wakeClaim: null, wakeFailedAt: new Date() }],
    ['booting', {}],
    ['running', { state: 'running', serveUrl: SERVE_URL }],
  ])(
    'answers 409 NOT_RUNNING for a %s row with no boot steps, launching nothing',
    async (_, row) => {
      await seedSandboxRow(row)
      const before = (await sandboxRows())[0]
      const { service, dispatch } = messagesWith()

      await expect(service.send(ARGS)).rejects.toMatchObject({
        status: 409,
        message: NOT_RUNNING_MESSAGE,
      })

      expect(await eventsOf()).toHaveLength(0)
      expect(dispatch).not.toHaveBeenCalled()
      const after = (await sandboxRows())[0]
      expect(after?.tokenHash).toBe(before?.tokenHash ?? '')
      expect(after?.sealedToken).toBe(before?.sealedToken ?? '')
      expect(after?.wakeClaim?.getTime()).toBe(before?.wakeClaim?.getTime())
    },
  )

  it('still launches for an API-provisioned row', async () => {
    await seedProvisionedRow({ wakeClaim: null, wakeFailedAt: new Date() })
    const { service, dispatch } = messagesWith()

    await service.send(ARGS)

    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
