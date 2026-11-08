import { describe, expect, it } from 'bun:test'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { setupSessionsService as setup, TEST_COMMAND } from './sessions.service.fixture'

const seed = async () => {
  const context = setup()
  const created = await context.service.create({ userId: 'user-a', projectId: 'proj-a' })
  return { ...context, sessionId: created.sessionId }
}

const inboxOf = (args: { plane: ReturnType<typeof setup>['plane']; sessionId: string }) =>
  args.plane.readInbox({ sessionId: args.sessionId, afterId: 0, limit: 10 })

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
