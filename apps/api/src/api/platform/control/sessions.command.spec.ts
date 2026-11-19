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
      credentialSource: 'byok',
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
    expect(context.resizer.resizes).toEqual([])
    expect(await inboxOf({ plane: context.plane, sessionId: created.sessionId })).toEqual([])
  })

  it('records the desired size and resizes through the pinned provider', async () => {
    const { service, plane, resizer, sessionId } = await seed()

    expect(
      await service.command({ userId: 'user-a', sessionId, name: 'resize', args: { vcpus: 4 } }),
    ).toEqual({})
    expect(resizer.resizes).toEqual([{ sandboxSessionId: sessionId, vcpus: 4 }])
    expect(await inboxOf({ plane, sessionId })).toEqual([])

    const row = await plane.readSession({ sessionId })
    expect(row?.podDesiredVcpus).toBe(4)
    expect(row?.podSizeGeneration).toBe(1)
    const view = await plane.readSessionView({ sessionId, threadId: row?.mainThreadId ?? '' })
    expect(view.value.status.pod).toEqual({ desiredVcpus: 4, phase: 'resizing' })
  })

  it('bumps the generation for each resize so a newer one supersedes the last', async () => {
    const { service, plane, resizer, sessionId } = await seed()

    await service.command({ userId: 'user-a', sessionId, name: 'resize', args: { vcpus: 4 } })
    await service.command({ userId: 'user-a', sessionId, name: 'resize', args: { vcpus: 8 } })

    const row = await plane.readSession({ sessionId })
    expect(row?.podSizeGeneration).toBe(2)
    expect(row?.podDesiredVcpus).toBe(8)
    expect(resizer.resizes).toEqual([
      { sandboxSessionId: sessionId, vcpus: 4 },
      { sandboxSessionId: sessionId, vcpus: 8 },
    ])
  })

  it('records the shared parent pod desired size for a sub-agent session', async () => {
    const { service, plane, resizer, store, sessionId } = await seed()
    const childId = await childOf({ store, parentId: sessionId })

    await service.command({
      userId: 'user-a',
      sessionId: childId,
      name: 'resize',
      args: { vcpus: 8 },
    })

    expect(resizer.resizes).toEqual([{ sandboxSessionId: sessionId, vcpus: 8 }])
    expect((await plane.readSession({ sessionId }))?.podDesiredVcpus).toBe(8)
    expect((await plane.readSession({ sessionId: childId }))?.podDesiredVcpus).toBeNull()
  })

  it('answers 404 when the pod is gone and posts nothing', async () => {
    const context = setup()
    const created = await context.service.create({ userId: 'user-a', projectId: 'proj-a' })
    context.resizer.failure = new NotFoundException(
      `sandbox atlas-v2-${created.sessionId} not found`,
    )

    const refused = context.service.command({
      userId: 'user-a',
      sessionId: created.sessionId,
      name: 'resize',
      args: { vcpus: 4 },
    })

    await expect(refused).rejects.toBeInstanceOf(NotFoundException)
    expect(
      (await context.plane.readSession({ sessionId: created.sessionId }))?.podResizeError,
    ).toBe(`sandbox atlas-v2-${created.sessionId} not found`)
    expect(await inboxOf({ plane: context.plane, sessionId: created.sessionId })).toEqual([])
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
