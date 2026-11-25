import { describe, expect, it } from 'bun:test'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { NOW, setupSessionsService as setup, TEST_COMMAND } from './sessions.service.fixture'

const seed = async () => {
  const context = setup()
  const created = await context.service.create({ userId: 'user-a', projectId: 'proj-a' })
  return { ...context, sessionId: created.sessionId }
}

const inboxOf = (args: { plane: ReturnType<typeof setup>['plane']; sessionId: string }) =>
  args.plane.readInbox({ sessionId: args.sessionId, afterId: 0, limit: 10 })

const childOf = async (args: {
  store: ReturnType<typeof setup>['store']
  parentId: string
}): Promise<string> => {
  const sessionId = 'child-session'
  await args.store.transact((tx) =>
    tx.createSession({
      sessionId,
      userId: 'user-a',
      projectId: null,
      mainThreadId: 'child-thread',
      modelRef: 'anthropic/claude-sonnet-4-5',
      modelEffort: 'medium',
      modelFast: false,
      sandboxProvider: 'vercel',
      credentialSource: 'platform',
      sandboxInstanceId: null,
      podSessionId: args.parentId,
      at: NOW,
    }),
  )
  return sessionId
}

describe('SessionsService command', () => {
  it('posts the validated arguments under the command inbox kind', async () => {
    const { plane, service, sessionId } = await seed()

    const posted = await service.command({
      userId: 'user-a',
      sessionId,
      name: 'test-rename',
      args: { title: 'Renamed' },
    })

    expect(posted).toEqual({ inboxId: 1 })
    const inbox = await inboxOf({ plane, sessionId })
    expect(inbox).toHaveLength(1)
    expect(inbox[0]?.kind).toBe(TEST_COMMAND.inboxKind)
    expect(inbox[0]?.kind).toBe('command:test-rename')
    expect(JSON.parse(inbox[0]?.payload ?? '')).toEqual({ title: 'Renamed' })
  })

  it('refuses an unknown command and posts nothing', async () => {
    const { plane, service, sessionId } = await seed()

    const refused = service.command({ userId: 'user-a', sessionId, name: 'nope', args: {} })

    expect(refused).rejects.toBeInstanceOf(BadRequestException)
    await refused.catch(() => undefined)
    expect(await inboxOf({ plane, sessionId })).toEqual([])
  })

  it.each([{}, { title: '' }, { title: 'x', extra: 1 }, 'text', null])(
    'refuses arguments %p that fail the schema and posts nothing',
    async (args) => {
      const { plane, service, sessionId } = await seed()

      const refused = service.command({ userId: 'user-a', sessionId, name: 'test-rename', args })

      expect(refused).rejects.toBeInstanceOf(BadRequestException)
      await refused.catch(() => undefined)
      expect(await inboxOf({ plane, sessionId })).toEqual([])
    },
  )

  it('refuses a Vercel resize above the 8 vCPU platform cap without touching the pod', async () => {
    const context = setup()
    const created = await context.service.create({ userId: 'user-a', projectId: 'proj-a' })

    const refused = context.service.command({
      userId: 'user-a',
      sessionId: created.sessionId,
      name: 'resize',
      args: { vcpus: 16, memoryGb: 32 },
    })

    await expect(refused).rejects.toBeInstanceOf(BadRequestException)
    expect(context.dispatcher.dispatches).toEqual([])
    expect(await inboxOf({ plane: context.plane, sessionId: created.sessionId })).toEqual([])
  })

  it('refuses an Agent37 resize off the Agent37 vm shapes', async () => {
    const context = setup()
    const created = await context.service.create({
      userId: 'user-a',
      projectId: 'proj-a',
      provider: 'agent37',
    })

    const refused = context.service.command({
      userId: 'user-a',
      sessionId: created.sessionId,
      name: 'resize',
      args: { vcpus: 6, memoryGb: 12 },
    })

    await expect(refused).rejects.toBeInstanceOf(BadRequestException)
    expect(
      await context.service.command({
        userId: 'user-a',
        sessionId: created.sessionId,
        name: 'resize',
        args: { vcpus: 8, memoryGb: 64 },
      }),
    ).toEqual({})
    expect(context.dispatcher.dispatches).toEqual([
      {
        payload: { sessionId: created.sessionId, generation: 1, vcpus: 8, memoryGb: 64 },
        idempotencyKey: `pod-resize:${created.sessionId}:1:0`,
      },
    ])
  })

  it('records the desired size on the session pod and dispatches the apply', async () => {
    const { service, plane, dispatcher, sessionId } = await seed()

    expect(
      await service.command({
        userId: 'user-a',
        sessionId,
        name: 'resize',
        args: { vcpus: 4, memoryGb: 16 },
      }),
    ).toEqual({})

    const row = await plane.readSession({ sessionId })
    expect(row?.podDesiredVcpus).toBe(4)
    expect(row?.podSizeGeneration).toBe(1)
    expect(dispatcher.dispatches).toEqual([
      {
        payload: { sessionId, generation: 1, vcpus: 4, memoryGb: 16 },
        idempotencyKey: `pod-resize:${sessionId}:1:0`,
      },
    ])
    const view = await plane.readSessionView({ sessionId, threadId: row?.mainThreadId ?? '' })
    expect(view.value.status.pod).toMatchObject({
      desiredShape: { vcpus: 4, memoryGb: 16 },
      desiredVcpus: 4,
      phase: 'resizing',
    })
  })

  it('records the bigger disk on an Agent37 pod and dispatches it beside the shape', async () => {
    const context = setup()
    const created = await context.service.create({
      userId: 'user-a',
      projectId: 'proj-a',
      provider: 'agent37',
    })

    expect(
      await context.service.command({
        userId: 'user-a',
        sessionId: created.sessionId,
        name: 'resize',
        args: { vcpus: 8, memoryGb: 64, diskGb: 30 },
      }),
    ).toEqual({})

    const row = await context.plane.readSession({ sessionId: created.sessionId })
    expect(row?.podDesiredDiskGb).toBe(30)
    expect(context.dispatcher.dispatches).toEqual([
      {
        payload: {
          sessionId: created.sessionId,
          generation: 1,
          vcpus: 8,
          memoryGb: 64,
          diskGb: 30,
        },
        idempotencyKey: `pod-resize:${created.sessionId}:1:0`,
      },
    ])
  })

  it('keeps the disk a pod already asked for when a later resize leaves it out', async () => {
    const context = setup()
    const created = await context.service.create({
      userId: 'user-a',
      projectId: 'proj-a',
      provider: 'agent37',
    })

    await context.service.command({
      userId: 'user-a',
      sessionId: created.sessionId,
      name: 'resize',
      args: { vcpus: 8, memoryGb: 64, diskGb: 30 },
    })
    await context.service.command({
      userId: 'user-a',
      sessionId: created.sessionId,
      name: 'resize',
      args: { vcpus: 4, memoryGb: 16 },
    })

    expect(
      (await context.plane.readSession({ sessionId: created.sessionId }))?.podDesiredDiskGb,
    ).toBe(30)
  })

  it('refuses a bigger disk on a Vercel pod without touching the pod', async () => {
    const context = setup()
    const created = await context.service.create({
      userId: 'user-a',
      projectId: 'proj-a',
      provider: 'vercel',
    })

    const refused = context.service.command({
      userId: 'user-a',
      sessionId: created.sessionId,
      name: 'resize',
      args: { vcpus: 4, memoryGb: 8, diskGb: 30 },
    })

    await expect(refused).rejects.toBeInstanceOf(BadRequestException)
    expect(context.dispatcher.dispatches).toEqual([])
    const row = await context.plane.readSession({ sessionId: created.sessionId })
    expect(row?.podSizeGeneration).toBe(0)
    expect(row?.podDesiredDiskGb).toBeNull()
  })

  it('bumps the generation for each resize so a newer one supersedes the last', async () => {
    const { service, plane, dispatcher, sessionId } = await seed()

    await service.command({
      userId: 'user-a',
      sessionId,
      name: 'resize',
      args: { vcpus: 4, memoryGb: 16 },
    })
    await service.command({
      userId: 'user-a',
      sessionId,
      name: 'resize',
      args: { vcpus: 8, memoryGb: 64 },
    })

    const row = await plane.readSession({ sessionId })
    expect(row?.podSizeGeneration).toBe(2)
    expect(row?.podDesiredVcpus).toBe(8)
    expect(dispatcher.dispatches.map((entry) => entry.idempotencyKey)).toEqual([
      `pod-resize:${sessionId}:1:0`,
      `pod-resize:${sessionId}:2:0`,
    ])
  })

  it('records the shared parent pod desired size for a sub-agent session', async () => {
    const { service, plane, dispatcher, store, sessionId } = await seed()
    const childId = await childOf({ store, parentId: sessionId })

    await service.command({
      userId: 'user-a',
      sessionId: childId,
      name: 'resize',
      args: { vcpus: 8, memoryGb: 16 },
    })

    expect((await plane.readSession({ sessionId }))?.podDesiredVcpus).toBe(8)
    expect((await plane.readSession({ sessionId: childId }))?.podDesiredVcpus).toBeNull()
    expect(dispatcher.dispatches.map((entry) => entry.payload)).toEqual([
      { sessionId, generation: 1, vcpus: 8, memoryGb: 16 },
    ])
  })

  it('refuses a session the caller does not own and posts nothing', async () => {
    const { plane, service, sessionId } = await seed()

    const refused = service.command({
      userId: 'user-b',
      sessionId,
      name: 'test-rename',
      args: { title: 'Renamed' },
    })

    expect(refused).rejects.toBeInstanceOf(NotFoundException)
    await refused.catch(() => undefined)
    expect(await inboxOf({ plane, sessionId })).toEqual([])
  })
})
