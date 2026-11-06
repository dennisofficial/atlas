import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { NoSessionTitler } from '../../../_core/ports/session-titler'
import { SessionsService } from './sessions.service'
import { ProjectAccess } from './project-access'

export const NOW = '2026-11-03T12:00:00.000Z'

class FakeProjectAccess extends ProjectAccess {
  async ownerOf(args: { projectId: string }): Promise<string | undefined> {
    return args.projectId === 'proj-a' ? 'user-a' : undefined
  }
}

class NoBackgroundWork extends BackgroundWork {
  keepAlive(): void {}
}

export const setupSessionsService = () => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  store.markHostPresent(9001)
  const plane = new ControlPlane({ store })
  const service = new SessionsService(
    plane,
    new FakeProjectAccess(),
    new NoSessionTitler(),
    new NoBackgroundWork(),
  )
  return { plane, service }
}
