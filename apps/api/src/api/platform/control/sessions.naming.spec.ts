import { describe, expect, it, spyOn } from 'bun:test'
import { Logger } from '@nestjs/common'
import { fallbackTitleOf } from '@dltech/atlas-control'
import type { SessionsService } from './sessions.service'
import { listedSession, setupNaming as setup } from './sessions.naming.fixture'

describe('SessionsService naming', () => {
  const titleOf = (args: { service: SessionsService; sessionId: string }) => listedSession(args)

  it('lists the session as naming right after the first post and titles it once the titler answers', async () => {
    const { service, titler, background } = setup()
    let answer: (title: string) => void = () => undefined
    titler.next = () => new Promise((resolve) => (answer = resolve))
    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
    })

    await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'fix the build',
    })

    const during = await titleOf({ service, sessionId: created.sessionId })
    expect(during?.title).toBeNull()
    expect(during?.naming).toBe(true)

    answer('Build Fix')
    await background.settle()

    const after = await titleOf({ service, sessionId: created.sessionId })
    expect(after?.title).toBe('Build Fix')
    expect(after?.naming).toBe(false)
    expect(titler.calls).toMatchObject([
      { userId: 'user-a', projectId: 'proj-a', text: 'fix the build' },
    ])
  })

  it('stores the fallback title when the titler answers nothing', async () => {
    const { service, background } = setup()
    const text = `${'word '.repeat(40)}end`
    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
    })

    await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text,
    })
    await background.settle()

    const after = await titleOf({ service, sessionId: created.sessionId })
    expect(after?.title).toBe(fallbackTitleOf(text))
    expect(after?.naming).toBe(false)
  })

  it('stores the fallback title when the titler throws', async () => {
    const { service, titler, background } = setup()
    titler.next = async () => {
      throw new Error('provider down')
    }
    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
    })

    await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'hello world',
    })
    await background.settle()

    const after = await titleOf({ service, sessionId: created.sessionId })
    expect(after?.title).toBe('hello world')
    expect(after?.naming).toBe(false)
  })

  it('hands the titler the model the session itself runs on', async () => {
    const { service, titler, background } = setup()
    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
      model: 'gateway/deepseek/deepseek-v4.1-flash-1017-fast',
    })

    await service.post({ userId: 'user-a', sessionId: created.sessionId, text: 'hello world' })
    await background.settle()

    expect(titler.calls[0]?.modelRef).toBe('gateway/deepseek/deepseek-v4.1-flash-1017-fast')
  })

  it('logs why the titler could not name the session and stores the fallback title', async () => {
    const { service, titler, background } = setup()
    const warned = spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    try {
      titler.report = new Error('This request would exceed your account monthly spend limit')
      const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

      await service.post({ userId: 'user-a', sessionId: created.sessionId, text: 'hello world' })
      await background.settle()

      const line = String(warned.mock.calls.at(-1)?.[0])
      expect(line).toContain(`naming ${created.sessionId} failed:`)
      expect(line).toContain('monthly spend limit')
      expect((await titleOf({ service, sessionId: created.sessionId }))?.title).toBe('hello world')
    } finally {
      warned.mockRestore()
    }
  })

  it('does not wait for naming before the post returns', async () => {
    const { service, titler } = setup()
    titler.next = () => new Promise(() => undefined)
    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
    })

    const posted = await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'hi',
    })

    expect(posted.inboxId).toBe(1)
  })

  it('never renames on a second post', async () => {
    const { service, titler, background } = setup()
    titler.next = async () => 'First Name'
    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
    })

    await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'first',
    })
    await background.settle()
    titler.next = async () => 'Second Name'
    await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'second',
    })
    await background.settle()

    expect((await titleOf({ service, sessionId: created.sessionId }))?.title).toBe('First Name')
    expect(titler.calls).toHaveLength(1)
  })

  it('renames from the resent message after the titled one is withdrawn', async () => {
    const { service, titler, background } = setup()
    titler.next = async () => 'First Name'
    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
    })
    const first = await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'a',
    })
    await background.settle()

    await service.withdraw({
      userId: 'user-a',
      sessionId: created.sessionId,
      inboxId: first.inboxId,
    })
    expect((await titleOf({ service, sessionId: created.sessionId }))?.title).toBeNull()

    titler.next = async () => 'Second Name'
    await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'b',
    })
    await background.settle()

    expect((await titleOf({ service, sessionId: created.sessionId }))?.title).toBe('Second Name')
    expect(titler.calls.map((call) => call.text)).toEqual(['a', 'b'])
  })

  it('drops a name that lands after its message was withdrawn', async () => {
    const { service, titler, background } = setup()
    let answer: (title: string) => void = () => undefined
    titler.next = () => new Promise((resolve) => (answer = resolve))
    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
    })
    const posted = await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'a',
    })

    await service.withdraw({
      userId: 'user-a',
      sessionId: created.sessionId,
      inboxId: posted.inboxId,
    })
    answer('Stale Name')
    await background.settle()

    expect((await titleOf({ service, sessionId: created.sessionId }))?.title).toBeNull()
  })

  it('never names a session created with a title', async () => {
    const { service, titler, background } = setup()
    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
      title: 'Kept',
    })

    await service.post({
      userId: 'user-a',
      sessionId: created.sessionId,
      text: 'ignored',
    })
    await background.settle()

    expect((await titleOf({ service, sessionId: created.sessionId }))?.title).toBe('Kept')
    expect(titler.calls).toHaveLength(0)
    expect(background.work).toHaveLength(0)
  })
})
