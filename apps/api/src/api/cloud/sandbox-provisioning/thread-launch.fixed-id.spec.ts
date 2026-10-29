import { ESandboxProvisionState } from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { seedThread, seedUser, useTestDatabase } from '@dltech/atlas-db/testing'
import { ConflictException } from '@nestjs/common'
import { describe, expect, it } from 'bun:test'
import { eventsOf, launchWith, sandboxRows, seedBase } from './sandbox-provisioning.fixture'
import type { ThreadLaunchService } from './thread-launch.service'

const FIRST = { sendId: 'snd-1', text: 'build me a thing' }
const FIXED_ID = 'brn_11111111-1111-4111-8111-111111111111'

const create = (service: ThreadLaunchService, draft: { id?: string } = {}) =>
  service.launch({ userId: 'usr-1', draft: { projectId: 'prj-1', ...draft }, firstMessage: FIRST })

const threads = () => db.orm.public.Thread.all()

describe('ThreadLaunchService with a client-chosen id', () => {
  useTestDatabase()

  it('launches under the id and claims, writes and dispatches for it', async () => {
    await seedBase()
    const { service, dispatch } = launchWith()

    const reply = await create(service, { id: FIXED_ID })

    expect(reply.thread.id).toBe(FIXED_ID)
    expect(reply.provision).toEqual({ state: ESandboxProvisionState.Booting })
    expect(await threads()).toMatchObject([{ id: FIXED_ID, userId: 'usr-1', head: 1 }])
    expect(await eventsOf(FIXED_ID)).toHaveLength(1)
    expect(await sandboxRows()).toMatchObject([
      { sessionId: expect.any(String), state: 'resuming' },
    ])
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('treats a retry of the same id and sendId as the same launch', async () => {
    await seedBase()
    const { service, dispatch } = launchWith()

    const first = await create(service, { id: FIXED_ID })
    const retry = await create(service, { id: FIXED_ID })

    expect(retry.thread.id).toBe(first.thread.id)
    expect(retry.provision).toEqual({ state: ESandboxProvisionState.Booting })
    expect(await threads()).toHaveLength(1)
    expect(await eventsOf(FIXED_ID)).toHaveLength(1)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('refuses the same sendId retried under a different id', async () => {
    await seedBase()
    const { service, dispatch } = launchWith()
    await create(service, { id: FIXED_ID })

    await expect(create(service, { id: 'brn_other' })).rejects.toBeInstanceOf(ConflictException)

    expect(await threads()).toMatchObject([{ id: FIXED_ID }])
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it('refuses an id on a retry of a launch that minted its own id', async () => {
    await seedBase()
    const { service } = launchWith()
    const first = await create(service)

    await expect(create(service, { id: FIXED_ID })).rejects.toBeInstanceOf(ConflictException)

    expect(await threads()).toMatchObject([{ id: first.thread.id }])
  })

  it('refuses an id already used by one of the same user threads and changes nothing', async () => {
    await seedBase()
    await seedThread({ db, id: FIXED_ID, userId: 'usr-1' })
    const { service, dispatch } = launchWith()

    await expect(create(service, { id: FIXED_ID })).rejects.toBeInstanceOf(ConflictException)

    expect(await threads()).toHaveLength(1)
    expect(await db.orm.public.Event.all()).toHaveLength(0)
    expect(await sandboxRows()).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('refuses an id owned by another user and never attaches to that thread', async () => {
    await seedBase()
    await seedUser({ db, id: 'usr-2' })
    await seedThread({ db, id: FIXED_ID, userId: 'usr-2' })
    const { service, dispatch } = launchWith()

    await expect(create(service, { id: FIXED_ID })).rejects.toBeInstanceOf(ConflictException)

    expect(await threads()).toMatchObject([{ id: FIXED_ID, userId: 'usr-2' }])
    expect(await db.orm.public.Event.all()).toHaveLength(0)
    expect(dispatch).not.toHaveBeenCalled()
  })
})
