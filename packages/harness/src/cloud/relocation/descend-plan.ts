import { readdir } from 'node:fs/promises'

import { ENoticeTone, EExecutionLocation, type LogPort, type NoticePort, type ThreadId } from '@dltech/atlas-core'

import { logFieldsOf } from '../../store/logs'
import { EClientRequest, publishedWorkspaceWireSchema } from '../channel-wire'
import type { RemoteMemoryMerge } from '../merge-remote-memory'
import { relocateSession } from '../../store/relocate-session'
import { mergePublishedWorkspace, type MergedWorkspace } from '../../workspace/merge-published'
import { atlasDirectory } from '../../store/paths'
import { sessionDirectory } from '../../store/sessions/paths'
import type { CloudBridge, CloudChannel } from './cloud-bridge'
import { awaitPause, reannounceChildren, transferTranscriptDown } from './descend-transfer'
import { ELiftStep } from './lift'
import { flipChildrenBack } from './lift-children'
import type { RelocationPlan } from './dag'
import {
  descendedConflictsDraft,
  descendedMemoryConflictsDraft,
  descendedSupersededDraft,
} from './transition-notice'
import {
  DESCEND_DESTROY_NOTICE_KEY,
  DESCEND_MEMORY_NOTICE_KEY,
  EDescendStep,
  type DescendLocalHome,
  type DescendProgressStep,
  type DescendSurface,
  type WorkspaceMerger,
} from './descend'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const PAUSE_DEADLINE_MS = 30_000

export type DescendRun = { pauseLanded: boolean }

export type DescendPlanArgs<Opened> = {
  threadId: ThreadId
  target: EExecutionLocation
  midTurn: boolean
  bridge: CloudBridge
  channel: CloudChannel
  localApp: DescendLocalHome
  surface: DescendSurface<Opened>
  notice: NoticePort
  progress: (step: DescendProgressStep) => void
  pauseDeadlineMs?: number | undefined
  mergeWorkspace?: WorkspaceMerger | undefined
  pullMemory?: (() => Promise<RemoteMemoryMerge>) | undefined
  run: DescendRun
  setOpened: (opened: Opened) => void
  logPort?: LogPort | undefined
  /** A test seam between the archive landing and the landed-state checks — live wiring never passes it. */
  afterTranscriptLanded?: (() => Promise<void>) | undefined
}

/**
 * The §4 descend plan: the remote loops pause at the seam before anything is read for the trip
 * home, the flip of the local store is the single commit point, and everything after it (workspace
 * merge, reopen, sandbox teardown) is recovery-by-reopen territory rather than rollback.
 */
export function descendPlan<Opened>(args: DescendPlanArgs<Opened>): RelocationPlan<undefined> {
  const { threadId, target, channel, localApp, progress } = args
  const sessionDir = sessionDirectory({ home: atlasDirectory(), sessionId: threadId })

  return [
    {
      id: 'pauseRemoteLoops',
      needs: [],
      run: async () => {
        if (!args.midTurn) return
        progress(ELiftStep.Interrupting)
        channel.pause()
        const settled = await awaitPause({
          channel,
          deadlineMs: args.pauseDeadlineMs ?? PAUSE_DEADLINE_MS,
        })
        if (!settled) throw new Error('the remote loops would not pause in time — nothing moved')
        args.run.pauseLanded = true
      },
    },
    {
      id: 'archiveRemote',
      needs: ['pauseRemoteLoops'],
      run: async () => {
        await transferTranscriptDown({ threadId, channel })
      },
    },
    {
      id: 'shipDown',
      needs: ['archiveRemote'],
      run: async () => {
        progress(EDescendStep.Transferring)
        await (args.afterTranscriptLanded ?? (async () => undefined))()
        await reannounceChildren({ threadId, threads: localApp.threads, log: localApp.log, ids: localApp.ids, logPort: args.logPort })
      },
    },
    {
      id: 'confirmLocal',
      needs: ['shipDown'],
      run: async () => {
        const entries = await readdir(sessionDir).catch((error: unknown) => {
          args.logPort?.warn({
            source: 'cloud.descend',
            message: 'the landed session directory could not be read — verifying it empty instead',
            threadId,
            data: { operation: 'read-landed-session-dir' },
            ...logFieldsOf({ error }),
          })
          return [] as string[]
        })
        if (!entries.includes('threads')) {
          throw new Error('the cloud transcript landed unusable — refusing to hand the conversation home')
        }
      },
    },
    {
      id: 'flipHome',
      needs: ['confirmLocal'],
      commit: true,
      run: async () => {
        progress(EDescendStep.Flipping)
        await localApp.threads.chooseExecutionLocation({ threadId, location: target })
        await flipChildrenBack({
          threadId,
          localThreads: localApp.threads,
          agents: localApp.agents,
          location: target,
        })
      },
    },
    {
      id: 'mergeWorkspace',
      needs: ['flipHome'],
      run: async () => {
        const merged = await mergeWorkspaceHome(args)
        if (merged.conflicts.length === 0 && merged.superseded === undefined) return
        await localApp.log.append({
          threadId,
          runId: localApp.ids.nextRunId(),
          drafts: [
            ...(merged.conflicts.length > 0
              ? [descendedConflictsDraft({ conflicts: merged.conflicts })]
              : []),
            ...(merged.superseded === undefined
              ? []
              : [descendedSupersededDraft({ superseded: merged.superseded })]),
          ],
        })
      },
    },
    {
      id: 'reopenLocal',
      needs: ['mergeWorkspace'],
      run: async () => {
        progress(EDescendStep.Relocating)
        await relocateSession({
          threadId,
          from: EExecutionLocation.Cloud,
          location: target,
          ...(target === EExecutionLocation.Host ? { cwd: localApp.workspace.workspace } : {}),
          log: localApp.log,
          ids: localApp.ids,
          services: localApp.services,
          agents: localApp.agents,
        })
        await pullMemoryHome(args)
        args.setOpened(await args.surface.openLocal(localApp, threadId))
      },
    },
    {
      id: 'resumePaused',
      needs: ['reopenLocal'],
      run: async () => {
        if (args.midTurn) channel.resume()
      },
    },
    {
      id: 'destroySandbox',
      needs: ['flipHome'],
      run: async () => {
        await args.bridge.sandboxes.destroy({ threadId }).catch((error: unknown) => {
          args.logPort?.warn({
            source: 'cloud.descend',
            message: 'the cloud sandbox could not be torn down',
            threadId,
            data: { operation: 'destroy-sandbox' },
            ...logFieldsOf({ error }),
          })
          args.notice.notify({
            key: DESCEND_DESTROY_NOTICE_KEY,
            text: `this conversation is home, but its cloud sandbox could not be torn down — ${messageOf(error)}`,
            tone: ENoticeTone.Warn,
            ttlMs: null,
          })
        })
      },
    },
  ]
}

async function mergeWorkspaceHome<Opened>(args: DescendPlanArgs<Opened>): Promise<MergedWorkspace> {
  const { channel, localApp } = args
  const result = await channel.request({ op: EClientRequest.PublishWorkspace, params: {} })
  const published = publishedWorkspaceWireSchema.parse(result)
  if (published === null) return { conflicts: [] }
  return (args.mergeWorkspace ?? mergePublishedWorkspace)({
    cwd: localApp.workspace.workspace,
    ref: published.ref,
    base: published.base,
    baseTree: published.baseTree ?? null,
    branch: published.branch ?? null,
  })
}

async function pullMemoryHome<Opened>(args: DescendPlanArgs<Opened>): Promise<void> {
  if (args.pullMemory === undefined) return
  const pulled = await args.pullMemory().catch((error: unknown) => {
    args.notice.notify({
      key: DESCEND_MEMORY_NOTICE_KEY,
      text: `this conversation is home, but the cloud's memory did not come down with it — ${messageOf(error)}`,
      tone: ENoticeTone.Warn,
      ttlMs: null,
    })
    return null
  })
  if (pulled !== null && pulled.conflicts.length > 0) {
    await args.localApp.log.append({
      threadId: args.threadId,
      runId: args.localApp.ids.nextRunId(),
      drafts: [descendedMemoryConflictsDraft({ conflicts: pulled.conflicts })],
    })
  }
}
