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

  it('refuses a resize outside the plan without touching the pod', async () => {
    const seen: { userId: string; vcpus: number }[] = []
    const context = setup({
      planGate: {
        assertWithinPlan: async (args) => {
          seen.push(args)
          throw new BadRequestException('16 vCPU exceeds the plan')
        },
      },
    })
    const created = await context.service.create({ userId: 'user-a', projectId: 'proj-a' })

    const refused = context.service.command({
      userId: 'user-a',
      sessionId: created.sessionId,
      name: 'resize',
      args: { vcpus: 16 },
    })

    await expect(refused).rejects.toBeInstanceOf(BadRequestException)
    expect(seen).toEqual([{ userId: 'user-a', vcpus: 16 }])
    expect(context.client.resizes).toEqual([])
    expect(await inboxOf({ plane: context.plane, sessionId: created.sessionId })).toEqual([])
  })

  it('resizes the shared pod at once, forgets its cached resources and posts nothing', async () => {
    const { service, client, plane, sessionId } = await seed()
    client.resources = { vcpus: 2, memoryMb: 4096 }

    await service.podResourcesOf({ userId: 'user-a', sessionId })
    expect(client.reads).toHaveLength(1)

    client.resources = { vcpus: 4, memoryMb: 8192 }
    expect(
      await service.command({ userId: 'user-a', sessionId, name: 'resize', args: { vcpus: 4 } }),
    ).toEqual({})
    expect(client.resizes).toEqual([{ userId: 'user-a', name: `atlas-v2-${sessionId}`, vcpus: 4 }])
    expect(await inboxOf({ plane, sessionId })).toEqual([])

    expect(await service.podResourcesOf({ userId: 'user-a', sessionId })).toEqual({
      vcpus: 4,
      memoryMb: 8192,
    })
    expect(client.reads).toHaveLength(2)
  })

  it('resizes the parent pod for a sub-agent session', async () => {
    const { service, client, store, sessionId } = await seed()
    const childId = await childOf({ store, parentId: sessionId })

    await service.command({
      userId: 'user-a',
      sessionId: childId,
      name: 'resize',
      args: { vcpus: 8 },
    })

    expect(client.resizes).toEqual([{ userId: 'user-a', name: `atlas-v2-${sessionId}`, vcpus: 8 }])
  })

  it('answers 404 when the pod is gone and posts nothing', async () => {
    const context = setup()
    const created = await context.service.create({ userId: 'user-a', projectId: 'proj-a' })
    context.client.failure = new NotFoundException(
      `sandbox atlas-v2-${created.sessionId} not found`,
    )

    const refused = context.service.command({
      userId: 'user-a',
      sessionId: created.sessionId,
      name: 'resize',
      args: { vcpus: 4 },
    })

    await expect(refused).rejects.toBeInstanceOf(NotFoundException)
    expect(await inboxOf({ plane: context.plane, sessionId: created.sessionId })).toEqual([])
  })

  it('reports the pod resources of the session pod', async () => {
    const { service, client, sessionId } = await seed()
    client.resources = { vcpus: 4, memoryMb: 8192, pendingVcpus: 8 }

    expect(await service.podResourcesOf({ userId: 'user-a', sessionId })).toEqual({
      vcpus: 4,
      memoryMb: 8192,
      pendingVcpus: 8,
    })
    expect(client.reads).toEqual([{ userId: 'user-a', name: `atlas-v2-${sessionId}` }])
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
