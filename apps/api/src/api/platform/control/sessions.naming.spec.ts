import { describe, expect, it } from 'bun:test'
import { ControlPlane, fallbackTitleOf } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { SessionTitler } from '../../../_core/ports/session-titler'
import { ProjectAccess } from './project-access'
import { FakeMediaRegistry } from './media-registry.fake'
import { SessionsService } from './sessions.service'

class FakeProjectAccess extends ProjectAccess {
  async ownerOf(args: { projectId: string }): Promise<string | undefined> {
    return args.projectId === 'proj-a' ? 'user-a' : undefined
  }
}

class FakeTitler extends SessionTitler {
  readonly calls: { userId: string; projectId: string; text: string }[] = []
  next: () => Promise<string | null> = async () => null

  async nameOf(args: { userId: string; projectId: string; text: string }) {
    this.calls.push(args)
    return this.next()
  }
}

class CollectingBackgroundWork extends BackgroundWork {
  readonly work: Promise<unknown>[] = []

  keepAlive(work: Promise<unknown>): void {
    this.work.push(work)
  }

  settle(): Promise<unknown> {
    return Promise.all(this.work)
  }
}

const liveClock = () => new Date().toISOString()

const setup = () => {
  const store = new InMemoryControlStore({ clock: liveClock })
  const plane = new ControlPlane({ store })
  const titler = new FakeTitler()
  const background = new CollectingBackgroundWork()
  const service = new SessionsService(
    plane,
    new FakeProjectAccess(),
    titler,
    background,
    new FakeMediaRegistry(),
  )
  return { service, titler, background }
}

describe('SessionsService naming', () => {
  const titleOf = async (args: { service: SessionsService; sessionId: string }) => {
    const listed = await args.service.list({ userId: 'user-a' })
    return listed.sessions.find((session) => session.sessionId === args.sessionId)
  }

  it('lists the session as naming right after the first post and titles it once the titler answers', async () => {
    const { service, titler, background } = setup()
    let answer: (title: string) => void = () => undefined
    titler.next = () => new Promise((resolve) => (answer = resolve))
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await service.post({ userId: 'user-a', sessionId: created.sessionId, text: 'fix the build' })

    const during = await titleOf({ service, sessionId: created.sessionId })
    expect(during?.title).toBeNull()
    expect(during?.naming).toBe(true)

    answer('Build Fix')
    await background.settle()

    const after = await titleOf({ service, sessionId: created.sessionId })
    expect(after?.title).toBe('Build Fix')
    expect(after?.naming).toBe(false)
    expect(titler.calls).toEqual([{ userId: 'user-a', projectId: 'proj-a', text: 'fix the build' }])
  })

  it('stores the fallback title when the titler answers nothing', async () => {
    const { service, background } = setup()
    const text = `${'word '.repeat(40)}end`
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await service.post({ userId: 'user-a', sessionId: created.sessionId, text })
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
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await service.post({ userId: 'user-a', sessionId: created.sessionId, text: 'hello world' })
    await background.settle()

    const after = await titleOf({ service, sessionId: created.sessionId })
    expect(after?.title).toBe('hello world')
    expect(after?.naming).toBe(false)
  })

  it('does not wait for naming before the post returns', async () => {
    const { service, titler } = setup()
    titler.next = () => new Promise(() => undefined)
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

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
    const created = await service.create({ userId: 'user-a', projectId: 'proj-a' })

    await service.post({ userId: 'user-a', sessionId: created.sessionId, text: 'first' })
    await background.settle()
    titler.next = async () => 'Second Name'
    await service.post({ userId: 'user-a', sessionId: created.sessionId, text: 'second' })
    await background.settle()

    expect((await titleOf({ service, sessionId: created.sessionId }))?.title).toBe('First Name')
    expect(titler.calls).toHaveLength(1)
  })

  it('never names a session created with a title', async () => {
    const { service, titler, background } = setup()
    const created = await service.create({
      userId: 'user-a',
      projectId: 'proj-a',
      title: 'Kept',
    })

    await service.post({ userId: 'user-a', sessionId: created.sessionId, text: 'ignored' })
    await background.settle()

    expect((await titleOf({ service, sessionId: created.sessionId }))?.title).toBe('Kept')
    expect(titler.calls).toHaveLength(0)
    expect(background.work).toHaveLength(0)
  })
})
