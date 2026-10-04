import { readdir } from 'node:fs/promises'

import { ENoticeTone, EExecutionLocation, type LogPort, type NoticePort, type PlacementRecord, type ThreadId } from '@dltech/atlas-core'

import type { PlacementTransaction } from '../../composition/placement-controller'
import { logFieldsOf } from '../../store/logs'
import type { RestoredWorkspace } from '../../workspace/transfer/manifest'
import type { WorkspaceRestoration } from '../../workspace/transfer/restore'
import { atlasDirectory } from '../../store/paths'
import { sessionDirectory } from '../../store/sessions/paths'
import type { CloudBridge, CloudChannel } from './cloud-bridge'
import { transferMemoryDown, transferTranscriptDown } from './descend-transfer'
import { prepareRelocation } from './prepare-relocation'
import { adoptTransferredChildren, activateTransferredChildren } from './adopt-transferred-children'
import { flipChildrenBack } from './lift-children'
import type { RelocationPlan } from './dag'
import { restoreCloudWorkspace, type WorkspaceRestorer } from './descend-workspace'
import { recordWorkspaceArrival } from './workspace-arrival'
import {
  DESCEND_DESTROY_NOTICE_KEY,
  descendDestroyRetry,
  type DescendLocalHome,
  type DescendSurface,
  type DestroySleeper,
} from './descend'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const PAUSE_DEADLINE_MS = 30_000

export enum EDescendNode {
  PauseRemoteLoops = 'pauseRemoteLoops',
  ArchiveRemote = 'archiveRemote',
  ArchiveMemory = 'archiveMemory',
  ShipDown = 'shipDown',
  ConfirmLocal = 'confirmLocal',
  FlipHome = 'flipHome',
  PrepareWorkspace = 'prepareWorkspace',
  ReopenLocal = 'reopenLocal',
  ActivateChildren = 'activateChildren',
  DestroySandbox = 'destroySandbox',
}

export type DescendRun = {
  pauseLanded: boolean
  pauseRequested: boolean
  restored: RestoredWorkspace | undefined
  restoration: WorkspaceRestoration | undefined
  home: DescendLocalHome
}

export type DescendPlanArgs<Opened> = {
  threadId: ThreadId
  target: EExecutionLocation
  midTurn: boolean
  bridge: CloudBridge
  channel: CloudChannel
  localApp: DescendLocalHome
  surface: DescendSurface<Opened>
  notice: NoticePort
  pauseDeadlineMs?: number | undefined
  restoreWorkspace?: WorkspaceRestorer | undefined
  run: DescendRun
  setOpened: (opened: Opened) => void
  logPort?: LogPort | undefined
  transaction?: PlacementTransaction | undefined
  afterTranscriptLanded?: (() => Promise<void>) | undefined
  sourceRecord?: PlacementRecord | undefined
  destroySleep: DestroySleeper
}

export function descendPlan<Opened>(args: DescendPlanArgs<Opened>): RelocationPlan<undefined> {
  const { threadId, target, channel, localApp } = args
  const sessionDir = sessionDirectory({ home: atlasDirectory(), sessionId: threadId })

  return [
    {
      id: EDescendNode.PauseRemoteLoops,
      needs: [],
      ...(args.midTurn ? { label: 'interrupting the turn at a clean break' } : {}),
      run: async () => {
        args.run.pauseRequested = true
        await prepareRelocation({
          pause: () => channel.pause(),
          onTurnEnded: (listener) => channel.onTurnEnded(listener),
          deadlineMs: args.pauseDeadlineMs ?? PAUSE_DEADLINE_MS,
        })
        args.run.pauseLanded = true
      },
    },
    {
      id: EDescendNode.ArchiveRemote,
      needs: [EDescendNode.PauseRemoteLoops],
      label: 'pulling the conversation down',
      run: async () => {
        await transferTranscriptDown({ threadId, channel, preserveOwnership: args.sourceRecord === undefined ? undefined : { record: args.sourceRecord, workspace: localApp.workspace } })
        await localApp.log.refresh({ threadId })
      },
    },
    {
      id: EDescendNode.ArchiveMemory,
      needs: [EDescendNode.ArchiveRemote],
      run: async () => {
        await transferMemoryDown({ channel, repoRoot: localApp.workspace.workspace })
      },
    },
    {
      id: EDescendNode.ShipDown,
      needs: [EDescendNode.ArchiveMemory],
      run: async () => {
        await (args.afterTranscriptLanded ?? (async () => undefined))()
        await adoptTransferredChildren({ agents: localApp.agents, threadId })
      },
    },
    {
      id: EDescendNode.ConfirmLocal,
      needs: [EDescendNode.ShipDown],
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
      id: EDescendNode.FlipHome,
      needs: [EDescendNode.ReopenLocal],
      commit: true,
      label: 'handing the conversation home',
      run: async () => {
        if (args.transaction === undefined) {
          await localApp.threads.chooseExecutionLocation({ threadId, location: target })
        } else {
          await args.transaction.commit()
        }
      },
    },
    {
      id: EDescendNode.PrepareWorkspace,
      needs: [EDescendNode.ConfirmLocal],
      label: 'restoring the workspace',
      run: async () => {
        args.run.restoration = await restoreCloudWorkspace({
          threadId,
          channel,
          bridge: args.bridge,
          destination: localApp.workspace.repo ?? localApp.workspace.workspace,
          restore: args.restoreWorkspace,
          logPort: args.logPort,
          beforeRestore: async () => {
            await transferTranscriptDown({ threadId, channel, preserveOwnership: args.sourceRecord === undefined ? undefined : { record: args.sourceRecord, workspace: localApp.workspace } })
            await localApp.log.refresh({ threadId })
            await adoptTransferredChildren({ agents: localApp.agents, threadId })
          },
        })
        args.run.restored = args.run.restoration.restored
        args.run.home = {
          ...localApp,
          workspace: { workspace: args.run.restored.cwd, repo: args.run.restored.repository },
        }
      },
    },
    {
      id: EDescendNode.ReopenLocal,
      needs: [EDescendNode.PrepareWorkspace],
      label: 'reopening the conversation locally',
      run: async () => {
        if (args.run.restored !== undefined) {
          await recordWorkspaceArrival({
            threadId,
            from: EExecutionLocation.Cloud,
            to: target,
            restored: args.run.restored,
            launchDirectory: localApp.workspace.workspace,
            log: localApp.log,
            threads: localApp.threads,
            ids: localApp.ids,
          })
          await adoptTransferredChildren({ agents: localApp.agents, threadId })
        }
        args.setOpened(await args.surface.openLocal(args.run.home, threadId))
      },
    },
    {
      id: EDescendNode.ActivateChildren,
      needs: [EDescendNode.FlipHome],
      run: async () => {
        await flipChildrenBack({ threadId, localThreads: localApp.threads, agents: localApp.agents, location: target })
        await activateTransferredChildren({ agents: localApp.agents, log: localApp.log, threadId })
      },
    },
    {
      id: EDescendNode.DestroySandbox,
      needs: [EDescendNode.ActivateChildren],
      run: async () => {
        void destroySandboxWithRetry(args).catch((error: unknown) => {
          args.logPort?.warn({
            source: 'cloud.descend',
            message: 'the sandbox teardown retry itself failed — the warning notice stands',
            threadId,
            data: { operation: 'destroy-sandbox-retry' },
            ...logFieldsOf({ error }),
          })
        })
      },
    },
  ]
}

async function destroySandboxWithRetry<Opened>(args: DescendPlanArgs<Opened>): Promise<void> {
  for (let attempt = 1; attempt <= descendDestroyRetry.attempts; attempt += 1) {
    try {
      await args.bridge.sandboxes.destroy({ threadId: args.threadId })
      if (attempt === 1) return
      args.notice.notify({
        key: DESCEND_DESTROY_NOTICE_KEY,
        text: 'the cloud sandbox was torn down after all',
        tone: ENoticeTone.Success,
      })
      return
    } catch (error: unknown) {
      args.logPort?.warn({
        source: 'cloud.descend',
        message: 'the cloud sandbox could not be torn down',
        threadId: args.threadId,
        data: { operation: 'destroy-sandbox' },
        ...logFieldsOf({ error }),
      })
      if (attempt === 1) {
        args.notice.notify({
          key: DESCEND_DESTROY_NOTICE_KEY,
          text: `this conversation is home, but its cloud sandbox could not be torn down — ${messageOf(error)}`,
          tone: ENoticeTone.Warn,
          ttlMs: null,
        })
      }
      if (attempt < descendDestroyRetry.attempts) {
        await args.destroySleep(descendDestroyRetry)
      }
    }
  }
}

