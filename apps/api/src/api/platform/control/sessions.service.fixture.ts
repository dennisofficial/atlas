import { composeCommands, defineCommand } from '@dltech/atlas-commands'
import { ECommandGroup, ECommandTiming } from '@dltech/atlas-core'
import { z } from 'zod'
import { FakeMediaStore } from '@dltech/atlas-media/testing'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { NoSessionTitler } from '../../../_core/ports/session-titler'
import { FakeMediaRegistry } from './media-registry.fake'
import { SessionsService } from './sessions.service'
import { ProjectAccess } from './project-access'
import { modelSet } from './model-set'

export const RENAME_ARGS = z.strictObject({ title: z.string().min(1) })

export const TEST_COMMAND = defineCommand({
  spec: {
    name: 'test-rename',
    summary: 'a command only the specs know',
    group: ECommandGroup.Session,
    args: RENAME_ARGS,
    timing: ECommandTiming.Settled,
    handledIn: 'pod',
  },
})

export const NOW = '2026-11-03T12:00:00.000Z'

class RecordingProjectAccess extends ProjectAccess {
  readonly ownerLookups: string[] = []

  async ownerOf(args: { projectId: string }): Promise<string | undefined> {
    this.ownerLookups.push(args.projectId)
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
  const registry = new FakeMediaRegistry()
  const mediaStore = new FakeMediaStore()
  const projects = new RecordingProjectAccess()
  const service = new SessionsService(
    plane,
    projects,
    new NoSessionTitler(),
    new NoBackgroundWork(),
    registry,
    mediaStore,
    composeCommands([TEST_COMMAND, modelSet]),
  )
  return { plane, service, registry, mediaStore, store, projects }
}
