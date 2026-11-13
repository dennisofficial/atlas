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
import {
  SessionModelChoice,
  type AccountRef,
  type SessionModelDefault,
} from './session-model-choice'

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

class FakeProjectAccess extends ProjectAccess {
  async ownerOf(args: { projectId: string }): Promise<string | undefined> {
    return args.projectId === 'proj-a' ? 'user-a' : undefined
  }
}

class NoBackgroundWork extends BackgroundWork {
  keepAlive(): void {}
}

export class FakeSessionModelChoice extends SessionModelChoice {
  readonly settings = new Map<string, unknown>()
  readonly accounts = new Map<string, AccountRef & { userId: string }>()
  readonly activeAccounts = new Map<string, string>()
  readonly writes: ({ sessionId: string } & SessionModelDefault)[] = []

  protected async settingValue(args: {
    userId: string
    projectId: string
    key: string
  }): Promise<unknown> {
    return this.settings.get(args.key)
  }

  protected async accountOf(args: {
    userId: string
    accountId: string
  }): Promise<AccountRef | undefined> {
    const row = this.accounts.get(args.accountId)
    if (row === undefined || row.userId !== args.userId) return undefined
    return { id: row.id, provider: row.provider }
  }

  protected async activeAccountOf(args: {
    userId: string
    provider: string
  }): Promise<string | undefined> {
    return this.activeAccounts.get(args.provider)
  }

  async write(args: { sessionId: string } & SessionModelDefault): Promise<boolean> {
    this.writes.push(args)
    return true
  }
}

export const setupSessionsService = () => {
  const store = new InMemoryControlStore({ clock: () => NOW })
  store.markHostPresent(9001)
  const plane = new ControlPlane({ store })
  const registry = new FakeMediaRegistry()
  const mediaStore = new FakeMediaStore()
  const choice = new FakeSessionModelChoice()
  const service = new SessionsService(
    plane,
    new FakeProjectAccess(),
    new NoSessionTitler(),
    new NoBackgroundWork(),
    registry,
    mediaStore,
    composeCommands([TEST_COMMAND, modelSet]),
    choice,
  )
  return { plane, service, registry, mediaStore, choice }
}
