import { describe, expect, it } from 'bun:test'
import { BadRequestException } from '@nestjs/common'
import { setupSessionsService } from './sessions.service.fixture'
import { nativeCommandRegistry, postCommand } from './command-registry'

const seed = async () => {
  const context = setupSessionsService()
  const created = await context.service.create({ userId: 'user-a', projectId: 'proj-a' })
  return { plane: context.plane, sessionId: created.sessionId }
}

describe('nativeCommandRegistry', () => {
  it('accepts rewind with a sequence and posts it under the command inbox kind', async () => {
    const { plane, sessionId } = await seed()
    const posted = await postCommand({
      plane,
      registry: nativeCommandRegistry(),
      sessionId,
      name: 'rewind',
      args: { toSeq: 3 },
    })
    expect(posted).toEqual({ inboxId: 1 })
    const [entry] = await plane.readInbox({ sessionId, afterId: 0, limit: 10 })
    expect(entry?.kind).toBe('command:rewind')
    expect(JSON.parse(entry?.payload ?? '')).toEqual({ toSeq: 3 })
  })

  it('refuses rewind with arguments the schema rejects', async () => {
    const { plane, sessionId } = await seed()
    const refused = postCommand({
      plane,
      registry: nativeCommandRegistry(),
      sessionId,
      name: 'rewind',
      args: { toSeq: 0 },
    })
    expect(refused).rejects.toBeInstanceOf(BadRequestException)
    await refused.catch(() => undefined)
  })

  it('refuses an unregistered name', async () => {
    const { plane, sessionId } = await seed()
    const refused = postCommand({
      plane,
      registry: nativeCommandRegistry(),
      sessionId,
      name: 'ghost',
      args: {},
    })
    expect(refused).rejects.toBeInstanceOf(BadRequestException)
    await refused.catch(() => undefined)
  })
})
