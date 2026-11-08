import { describe, expect, it } from 'bun:test'
import { BadRequestException } from '@nestjs/common'
import { setupSessionsService } from './sessions.service.fixture'
import { composeCommands } from '@dltech/atlas-commands'
import { composePlugins } from '@dltech/atlas-plugin-sdk'
import { createFixturePlugin } from '@dltech/atlas-plugin-sdk/testing'
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

  it('runs rename inline, answers {} and appends nothing to the inbox', async () => {
    const { plane, sessionId } = await seed()
    await plane.titleUntitledSession({ sessionId, title: 'Auto' })
    const answered = await postCommand({
      plane,
      registry: nativeCommandRegistry(),
      sessionId,
      name: 'rename',
      args: { name: '  Mine ' },
    })
    expect(answered).toEqual({})
    expect((await plane.readSession({ sessionId }))?.title).toBe('Mine')
    expect(await plane.readInbox({ sessionId, afterId: 0, limit: 10 })).toEqual([])
  })

  it('refuses rename with an empty name and leaves the title', async () => {
    const { plane, sessionId } = await seed()
    const refused = postCommand({
      plane,
      registry: nativeCommandRegistry(),
      sessionId,
      name: 'rename',
      args: { name: '   ' },
    })
    expect(refused).rejects.toBeInstanceOf(BadRequestException)
    await refused.catch(() => undefined)
    expect(await plane.readInbox({ sessionId, afterId: 0, limit: 10 })).toEqual([])
  })

  it('still queues a pod command with its inbox id after a rename', async () => {
    const { plane, sessionId } = await seed()
    const registry = nativeCommandRegistry()
    await postCommand({ plane, registry, sessionId, name: 'rename', args: { name: 'A' } })
    const posted = await postCommand({
      plane,
      registry,
      sessionId,
      name: 'rewind',
      args: { toSeq: 2 },
    })
    expect(posted).toEqual({ inboxId: 1 })
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

describe('a plugin command', () => {
  const fixture = () => {
    const { plugin, record } = createFixturePlugin()
    const composed = composePlugins([plugin])
    return { composed, record, registry: composeCommands(composed.commands) }
  }

  it('posts a plugin pod command to the inbox under its command kind', async () => {
    const { plane, sessionId } = await seed()
    const { registry } = fixture()
    const posted = await postCommand({
      plane,
      registry,
      sessionId,
      name: 'probe-observe',
      args: { label: 'x' },
    })
    expect(posted).toEqual({ inboxId: 1 })
    const [entry] = await plane.readInbox({ sessionId, afterId: 0, limit: 10 })
    expect(entry?.kind).toBe('command:probe-observe')
  })

  it('runs a plugin control command inline without touching the inbox', async () => {
    const { plane, sessionId } = await seed()
    const { registry, composed, record } = fixture()
    const answered = await postCommand({
      plane,
      registry,
      sessionId,
      name: 'probe-read',
      args: {},
      controlHandlers: composed.control.commands,
    })
    expect(answered).toEqual({})
    expect(record.controlReads).toEqual([sessionId])
    expect(await plane.readInbox({ sessionId, afterId: 0, limit: 10 })).toEqual([])
    expect(registry.byInboxKind.has('command:probe-read')).toBe(false)
  })
})
