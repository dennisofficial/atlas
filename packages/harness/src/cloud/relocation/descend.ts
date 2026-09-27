import {
  EExecutionLocation,
  type EventLogPort,
  type IdPort,
  type NoticePort,
  type ThreadId,
  type WorkspaceIdentity,
} from '@dltech/atlas-core'

import type { AgentRegistryPort } from '../../agents/registry/port'
import type { ServiceRegistryPort } from '../../services/service-registry'
import type { ToolRegistry } from '../../tools/registry'
import type { RemoteMemoryMerge } from '../merge-remote-memory'
import type { ThreadStorePort } from '../../store/thread-store'
import type { TurnLedgerPort } from '../../ledger/turn-ledger.port'
import type { MergedWorkspace } from '../../workspace/merge-published'
import type { CloudBridge, CloudChannel } from './cloud-bridge'
import { ELiftStep } from './lift'
import { runRelocation } from './dag'
import { descendPlan, type DescendRun } from './descend-plan'

export enum EDescendStep {
  Transferring = 'transferring',
  Flipping = 'flipping',
  Relocating = 'relocating',
}

export type DescendProgressStep = ELiftStep.Interrupting | EDescendStep

export const DESCEND_DESTROY_NOTICE_KEY = 'descend-sandbox-destroy-failed'

export const DESCEND_MEMORY_NOTICE_KEY = 'descend-memory-pull-failed'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const NO_PROTECTION = (): void => undefined

const nullNotice: NoticePort = { notify: () => undefined }

/**
 * The ports on the side the conversation is coming home to, cut down to what the descend touches.
 * `services` and `agents` come from the target session's own registry ports; `tools`/`ledger`
 * are carried so the surface can reopen the conversation from the same bag it handed in.
 */
export type DescendLocalHome = {
  threads: ThreadStorePort
  log: EventLogPort
  ledger: TurnLedgerPort
  agents: AgentRegistryPort
  ids: IdPort
  workspace: WorkspaceIdentity
  services: ServiceRegistryPort
  tools: ToolRegistry
}

/**
 * The surface's part of a descend: progress steps, operator notices, and the reopen. A session
 * that came home without its local half being reopened is half a descend, so `openLocal` is
 * required and its failure fails the move; `protect` is the surface's chance to hold the session
 * in place (the TUI dims it under the move overlay) from the first step until the descend returns.
 */
export type DescendSurface<Opened> = {
  notice: NoticePort
  onBegin?: ((args: { plan: readonly DescendProgressStep[] }) => void) | undefined
  onProgress?: ((step: DescendProgressStep) => void) | undefined
  protect?: (() => () => void) | undefined
  openLocal: (home: DescendLocalHome, threadId: ThreadId) => Promise<Opened>
}

export type WorkspaceMerger = (args: {
  cwd: string
  ref: string
  base: string | null
  baseTree: string | null
  branch: string | null
}) => Promise<MergedWorkspace>

/**
 * Bringing a cloud conversation home: pause the remote loops at a resumable seam, move the log's
 * home back (the cloud tail the local store missed, then the relocation marker into the local
 * log), flip the local store, merge the published workspace, and hand back the locally-reopened
 * conversation. Any failure before the flip leaves the cloud session attached and the conversation
 * exactly where it was; a failure after the flip is recovered by reopening, never by flipping back.
 */
export async function descendFromCloud<Opened>(args: {
  threadId: ThreadId
  target: EExecutionLocation
  midTurn: boolean
  bridge: CloudBridge
  channel: CloudChannel
  localApp: DescendLocalHome
  surface: DescendSurface<Opened>
  pauseDeadlineMs?: number | undefined
  mergeWorkspace?: WorkspaceMerger | undefined
  /**
   * Pulls the cloud's memory archive down over the local one — the cloud copy is newer at descend.
   * Optional so a spec never fetches; a failure warns and never blocks the descend. Conflicts the
   * local copy won come back so their cloud versions can be kept in the log, never dropped.
   */
  pullMemory?: (() => Promise<RemoteMemoryMerge>) | undefined
}): Promise<Opened> {
  const { threadId, target, bridge, channel, localApp, surface } = args
  const notice = surface.notice ?? nullNotice
  const progress = (step: DescendProgressStep): void => surface.onProgress?.(step)

  surface.onBegin?.({
    plan: args.midTurn
      ? [ELiftStep.Interrupting, EDescendStep.Transferring, EDescendStep.Flipping, EDescendStep.Relocating]
      : [EDescendStep.Transferring, EDescendStep.Flipping, EDescendStep.Relocating],
  })
  const release = surface.protect === undefined ? NO_PROTECTION : surface.protect()

  let opened: Opened | undefined
  const run: DescendRun = { pauseLanded: false }
  const result = await runRelocation({
    plan: descendPlan<Opened>({
      threadId,
      target,
      midTurn: args.midTurn,
      bridge,
      channel,
      localApp,
      surface,
      notice,
      progress,
      pauseDeadlineMs: args.pauseDeadlineMs,
      mergeWorkspace: args.mergeWorkspace,
      pullMemory: args.pullMemory,
      run,
      setOpened: (value) => {
        opened = value
      },
    }),
    ctx: undefined,
    onStep: () => undefined,
  })

  release()
  if (!result.ok) {
    if (result.phase === 'pre-commit' && run.pauseLanded) channel.resume()
    throw result.error instanceof Error ? result.error : new Error(messageOf(result.error))
  }
  if (opened === undefined) {
    throw new Error('the descend finished without reopening the conversation locally')
  }
  return opened
}
