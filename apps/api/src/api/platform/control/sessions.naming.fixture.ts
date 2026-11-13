import { composeCommands } from '@dltech/atlas-commands'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { FakeMediaStore } from '@dltech/atlas-media/testing'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { SessionTitler } from '../../../_core/ports/session-titler'
import { FakeMediaRegistry } from './media-registry.fake'
import { ProjectAccess } from './project-access'
import { SessionsService } from './sessions.service'
import { FakeSessionModelChoice } from './sessions.service.fixture'

class FakeProjectAccess extends ProjectAccess {
  async ownerOf(args: { projectId: string }): Promise<string | undefined> {
    return args.projectId === 'proj-a' ? 'user-a' : undefined
  }
}

export class FakeTitler extends SessionTitler {
  readonly calls: Parameters<SessionTitler['nameOf']>[0][] = []
  next: () => Promise<string | null> = async () => null
  report: Error | null = null

  async nameOf(args: Parameters<SessionTitler['nameOf']>[0]) {
    this.calls.push(args)
    if (this.report !== null) args.onFault?.(this.report)
    return this.next()
  }
}

export class CollectingBackgroundWork extends BackgroundWork {
  readonly work: Promise<unknown>[] = []

  keepAlive(work: Promise<unknown>): void {
    this.work.push(work)
  }

  settle(): Promise<unknown> {
    return Promise.all(this.work)
  }
}

export const setupNaming = () => {
  const store = new InMemoryControlStore({ clock: () => new Date().toISOString() })
  const plane = new ControlPlane({ store })
  const titler = new FakeTitler()
  const background = new CollectingBackgroundWork()
  const registry = new FakeMediaRegistry()
  const mediaStore = new FakeMediaStore()
  const service = new SessionsService(
    plane,
    new FakeProjectAccess(),
    titler,
    background,
    registry,
    mediaStore,
    composeCommands([]),
    new FakeSessionModelChoice(),
  )
  return { service, titler, background, registry, mediaStore }
}

export const listedSession = async (args: { service: SessionsService; sessionId: string }) => {
  const listed = await args.service.list({ userId: 'user-a' })
  return listed.sessions.find((session) => session.sessionId === args.sessionId)
}
