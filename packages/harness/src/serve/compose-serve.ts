import { ENoticeTone, EventLogPort, type NoticePort } from '@dltech/atlas-core'

import { RemoteEventLog } from '../cloud/remote-event-log'
import { RemoteThreadStore } from '../cloud/remote-thread-store'
import { RemoteTurnLedger } from '../cloud/remote-turn-ledger'
import { SessionsClient } from '../cloud/sessions-client'
import { composeHarness } from '../composition/compose'
import { loadSettings } from '../composition/settings-binding'
import { portToken } from '../container/injection'
import { TurnLedgerPort } from '../ledger/turn-ledger.port'
import { ThreadStorePort } from '../store/thread-store'

import { adoptChildren } from './adopt-children'
import type { ServeApp, ServeCompose } from './serve-app'
import { seedServeSession } from './serve-session'

export const SERVE_COMMAND = 'serve'

type ServeStores = { log: EventLogPort; threads: ThreadStorePort }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

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

  const client = new SessionsClient({
    url: args.controlPlaneUrl,
    token: args.token,
    clientVersion: args.clientVersion,
  })

  const app = await composeHarness<ServeStores>({
    launch: {
      cwd: args.cwd,
      command: SERVE_COMMAND,
      model: args.model,
      executionLocation: undefined,
    },
    env: args.env,
    settings: loadSettings({ env: args.env, cwd: args.cwd }),
    clientVersion: args.clientVersion,
    surface: {
      notice: args.notice,
      bind: ({ container }) => {
        const log = loggingOnAppendFailure({ log: new RemoteEventLog({ client }), notice: args.notice })
        const threads = new RemoteThreadStore({ client })

        container.register(portToken(EventLogPort), { useValue: log })
        container.register(portToken(ThreadStorePort), { useValue: threads })
        container.register(portToken(TurnLedgerPort), { useValue: new RemoteTurnLedger({ client }) })

        return { log, threads }
      },
    },
  })

  return {
    channel: app.channel,
    runner: app.runner,
    log: app.surface.log,
    threads: app.surface.threads,
    ids: app.ids,
    files: app.files,
    workspace: app.workspace,
    adoptChildren: ({ threadId }) =>
      adoptChildren({ agents: app.agents, log: app.surface.log, threadId }),
    whenChildrenSettled: ({ threadId }) => app.agents.whenChildrenSettled({ threadId }),
    close: app.close,
  }
}
