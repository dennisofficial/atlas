import {
  AccountStorePort,
  ClockPort,
  CredentialPort,
  ENoticeTone,
  EServiceStatus,
  EShellStatus,
  EventLogPort,
  NOTICE_WARN_MS,
  ProcessPort,
  type NoticePort,
} from '@dltech/atlas-core'

import { RemoteEventLog } from '../cloud/remote-event-log'
import { RemoteThreadStore } from '../cloud/remote-thread-store'
import { RemoteTurnLedger } from '../cloud/remote-turn-ledger'
import { sandboxNameFor } from '../cloud/sandbox-names'
import { SessionsClient } from '../cloud/sessions-client'
import { UserContextClient } from '../cloud/user-context-client'
import { VercelDriver, type VercelCredentials } from '../cloud/vercel-driver'
import { composeHarness } from '../composition/compose'
import { loadSettings } from '../composition/settings-binding'
import { portToken } from '../container/injection'
import { SecretsStoreToken, ServeSessionToken } from '../container/tokens'
import { TurnLedgerPort } from '../ledger/turn-ledger.port'
import { memoryDirectoriesFor } from '../memory/read-memory'
import { ShellRecovery } from '../shells/recovery'
import { atlasDirectory } from '../store/paths'
import { ThreadStorePort } from '../store/thread-store'

import { adoptChildren } from './adopt-children'
import type { ServeApp, ServeCompose } from './serve-app'
import { ServeProcessPort } from './serve-process'
import { ServeAccountStore } from './serve-account-store'
import { ServeBrokerClient } from './serve-broker-client'
import { ServeCredentialPort } from './serve-credential-port'
import { ServeSecretsStore } from './serve-secrets-store'
import { seedServeSession } from './serve-session'
import { createMemoryUploader } from './upload-memory'

export const SERVE_COMMAND = 'serve'

type ServeStores = { log: EventLogPort; threads: ThreadStorePort }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const given = (value: string | undefined): string | undefined =>
  value === undefined || value.trim().length === 0 ? undefined : value.trim()

/**
 * The sandbox was created with the operator's Vercel credentials in its environment precisely so
 * serve can publish ports itself; a sandbox older than that wiring simply cannot expose.
 */
const vercelCredentialsOf = (
  env: Record<string, string | undefined>,
): VercelCredentials | null => {
  const token = given(env.VERCEL_TOKEN)
  const teamId = given(env.VERCEL_TEAM_ID)
  const projectId = given(env.VERCEL_PROJECT_ID)
  if (token === undefined || teamId === undefined || projectId === undefined) return null
  return { token, teamId, projectId }
}

/**
 * A failed append on the sandbox is otherwise invisible: the turn it belongs to just dies, and the
 * serve log says nothing. The surface notice port is the serve log (LoggingNoticePort), so the
 * refusal lands where the next attach can read it.
 */
const loggingOnAppendFailure = (args: { log: EventLogPort; notice: NoticePort }): EventLogPort => ({
  append: async (appendArgs) => {
    try {
      return await args.log.append(appendArgs)
    } catch (error) {
      args.notice.notify({
        tone: ENoticeTone.Warn,
        text: `the control plane refused an event append for ${appendArgs.threadId}: ${messageOf(error)}`,
      })
      throw error
    }
  },
  read: (readArgs) => args.log.read(readArgs),
  readOwn: (readArgs) => args.log.readOwn(readArgs),
  head: (headArgs) => args.log.head(headArgs),
  replace: (replaceArgs) => args.log.replace(replaceArgs),
})

/**
 * The shared root, bound for a sandbox: durable state lives in the control plane rather than on a
 * disk that dies with the container. The stores the surface registers are handed back rather than
 * read off the app, because the root resolves its own before the surface binds.
 */
export const composeServeApp: ServeCompose = async (args): Promise<ServeApp> => {
  seedServeSession({ url: args.controlPlaneUrl, token: args.token })

  const broker = new ServeBrokerClient({
    url: args.controlPlaneUrl,
    token: args.token,
    threadId: args.threadId,
    clientVersion: args.clientVersion,
  })
  const secrets = new ServeSecretsStore({ broker })

  const client = new SessionsClient({
    url: args.controlPlaneUrl,
    token: args.token,
    clientVersion: args.clientVersion,
  })

  const identity = args.identity ?? null
  const keyPrefix =
    identity !== null
      ? `project/${encodeURIComponent(identity)}`
      : args.projectDirectory === null || args.projectDirectory === undefined
        ? 'project'
        : `project/${encodeURIComponent(args.projectDirectory)}`

  const memory = createMemoryUploader({
    client: new UserContextClient({
      url: args.controlPlaneUrl,
      token: args.token,
      clientVersion: args.clientVersion,
    }),
    atlasHome: atlasDirectory(),
    project: {
      directory: memoryDirectoriesFor({
        atlasHome: atlasDirectory(),
        repoRoot: args.cwd,
        identity,
      }).project,
      keyPrefix,
    },
    notice: args.notice,
  })

  const app = await composeHarness<ServeStores>({
    repoIdentity: identity,
    bindPorts: ({ container }) => {
      container.register(portToken(AccountStorePort), { useValue: new ServeAccountStore({ broker }) })
      container.register(portToken(CredentialPort), {
        useFactory: (resolver) =>
          new ServeCredentialPort({ broker, clock: resolver.resolve(portToken(ClockPort)) }),
      })
      container.register(SecretsStoreToken, { useValue: secrets })
      container.register(ServeSessionToken, {
        useValue: { url: args.controlPlaneUrl, token: args.token, email: null },
      })
    },
    launch: {
      cwd: args.cwd,
      command: SERVE_COMMAND,
      model: args.model,
      executionLocation: undefined,
    },
    env: args.env,
    settings: loadSettings({ env: args.env, cwd: args.cwd }),
    clientVersion: args.clientVersion,
    capabilities: args.capabilities === undefined ? undefined : () => args.capabilities,
    surface: {
      notice: args.notice,
      bind: ({ container }) => {
        const log = loggingOnAppendFailure({ log: new RemoteEventLog({ client }), notice: args.notice })
        const threads = new RemoteThreadStore({ client })

        container.register(portToken(EventLogPort), { useValue: log })
        container.register(portToken(ThreadStorePort), { useValue: threads })
        container.register(portToken(TurnLedgerPort), { useValue: new RemoteTurnLedger({ client }) })
        const credentials = vercelCredentialsOf(args.env)
        container.register(portToken(ProcessPort), {
          useValue: new ServeProcessPort(
            credentials === null
              ? null
              : {
                  driver: new VercelDriver({
                    credentials,
                    cloudUrl: args.controlPlaneUrl,
                  }),
                  name: sandboxNameFor({ threadId: args.threadId }),
                },
          ),
        })

        return { log, threads }
      },
    },
  })

  try {
    await secrets.warm()
  } catch (error) {
    args.notice.notify({
      key: 'cloud:secrets',
      tone: ENoticeTone.Warn,
      ttlMs: NOTICE_WARN_MS,
      text: `Atlas Cloud secrets could not be loaded (${messageOf(error)}) — cloud-backed keys stay unread until it comes back.`,
    })
  }

  const shellRecovery = new ShellRecovery({ log: app.surface.log, ids: app.ids })

  return {
    channel: app.channel,
    runner: app.runner,
    turnPolicy: app.turnPolicy,
    log: app.surface.log,
    threads: app.surface.threads,
    ids: app.ids,
    files: app.files,
    workspace: app.workspace,
    adoptChildren: ({ threadId }) =>
      adoptChildren({ agents: app.agents, log: app.surface.log, threadId }),
    recordLostShells: ({ threadId }) => shellRecovery.recordLost({ threadId }),
    whenChildrenSettled: ({ threadId }) => app.agents.whenChildrenSettled({ threadId }),
    syncMemoryAfterTurn: memory.syncAfterTurn,
    runningShells: () =>
      app.shells.listEverywhere().filter((shell) => shell.status === EShellStatus.Running).length,
    runningServices: () =>
      app.services.list().filter((service) => service.status === EServiceStatus.Running).length,
    roster: {
      snapshot: () => ({
        shells: [...app.shells.listEverywhere()],
        agents: [...app.agents.listEverywhere()],
        services: [...app.services.list()],
      }),
      subscribe: (listener) => {
        const offs = [
          app.shells.subscribe(listener),
          app.agents.onChange(listener),
          app.services.subscribe(listener),
        ]
        return () => {
          for (const off of offs) off()
        }
      },
    },
    wakeNotices: {
      pendingShells: ({ threadId }) => app.shells.pendingNotices({ threadId }).length,
      pendingAgents: ({ threadId }) => app.agents.pendingNotices({ threadId }).length,
      pendingServices: ({ threadId }) => app.services.pendingNotices({ threadId }).length,
      subscribe: (listener) => {
        const offs = [
          app.shells.onNotice(listener),
          app.agents.onNotice(listener),
          app.services.onNotice(listener),
        ]
        return () => {
          for (const off of offs) off()
        }
      },
    },
    rewind: {
      target: {
        removeChildren: (removeArgs) => app.agents.removeChildren(removeArgs),
        removeShells: (removeArgs) => app.shells.removeShells(removeArgs),
        removeServices: (removeArgs) => app.services.removeServices(removeArgs),
      },
    },
    close: app.close,
  }
}
