import type {
  EventLogPort,
  IdPort,
  NoticePort,
  ThreadId,
  WorkspaceIdentity,
} from '@dltech/atlas-core'

import type { DeltaChannel } from '../channel/delta-channel'
import type { FileBrowser } from '../files/file-browser'
import type { TurnRunner } from '../loop/turn-runner.port'
import type { ThreadStorePort } from '../store/thread-store'

/** The composed session as serve consumes it: everything a socket can reach and nothing else. */
export type ServeApp = {
  channel: DeltaChannel
  runner: Pick<TurnRunner, 'runTurn'>
  log: Pick<EventLogPort, 'append' | 'read'>
  threads: Pick<ThreadStorePort, 'find' | 'createWithFirstEvents'>
  ids: Pick<IdPort, 'nextRunId'>
  files: Pick<FileBrowser, 'list' | 'forget'>
  workspace: WorkspaceIdentity
  close: () => Promise<void>
}

export type ServeComposeArgs = {
  threadId: ThreadId
  cwd: string
  controlPlaneUrl: string
  token: string
  clientVersion: string
  env: Record<string, string | undefined>
  model: string | undefined
  notice: NoticePort
}

export type ServeCompose = (args: ServeComposeArgs) => Promise<ServeApp>
