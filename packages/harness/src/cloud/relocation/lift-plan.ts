import {
  CLOUD_WORKSPACE_PATH,
  EExecutionLocation,
  EHarnessPlacement,
  type Event,
  type LogPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { PlacementTransaction } from '../../composition/placement-controller'
import type { OwnerTransaction, SessionRuntime } from '../../composition/session-owner'
import { buildSessionArchive } from '../session-archive'
import { activateSessionReplySchema, applyWorkspaceArchiveReplySchema, EClientRequest } from '../channel-wire'
import type { RestoredWorkspace } from '../../workspace/transfer/manifest'
import { logFieldsOf } from '../../store/logs'
import { atlasDirectory } from '../../store/paths'
import { sessionDirectory } from '../../store/sessions/paths'
import { exportGpgMaterial } from '../../workspace/gpg-material'
import type { CloudAttachment, CloudChannel, CloudSandbox, LiftedWorkspace } from './cloud-bridge'
import { verifyTranscript } from './verify-transcript'
import type { RelocationPlan } from './dag'
import { flipChildrenToCloud } from './lift-children'
import { ELiftStep, type LiftArgs } from './lift'
import { destroyLiftedWorktree } from './lift-destroy'
import { liftedDraft, type StoppedLocally } from './transition-notice'
import { captureLiftWorkspace, type LiftWorkspaceArchive } from './lift-workspace'
import { liftSettledBeforeDeadline } from './lift-failure'

export enum ELiftNode {
  InterruptTurn = 'interruptTurn',
  CaptureWorkspace = 'captureWorkspace',
  CaptureGpg = 'captureGpg',
  PauseLoops = 'pauseLoops',
  StampModel = 'stampModel',
  ArchiveSession = 'archiveSession',
  Provision = 'provision',
  ConfirmLanded = 'confirmLanded',
  Restore = 'restore',
  FlipOwnership = 'flipOwnership',
  Attach = 'attach',
  ActivateFamily = 'activateFamily',
  ResumePaused = 'resumePaused',
  DestroyLocalWorktree = 'destroyLocalWorktree',
}

export type LiftCtx = {
  args: LiftArgs
  onWaveLabel?: ((nodeId: string, label: string) => void) | undefined
  logPort?: LogPort | undefined
  transaction: PlacementTransaction | OwnerTransaction<SessionRuntime>
  from: EExecutionLocation
  workspace: LiftedWorkspace | null
  workspaceArchive: LiftWorkspaceArchive | undefined
  restoredWorkspace: RestoredWorkspace | undefined
  gpgKey: string | undefined
  transcript: Uint8Array | undefined
  sandbox: CloudSandbox | undefined
  channel: CloudChannel | undefined
  attachment: CloudAttachment | undefined
  expected: Map<ThreadId, readonly Event[]>
  contextError: unknown
  stopped: StoppedLocally
  pausedChildren: readonly ThreadId[]
}

/**
 * The lift's model-facing relocation notice lands in the local log after the archive shipped, so
 * the copy the sandbox serves does not carry it — it is for whoever opens the local transcript
 * between the flip and the move. The `location-changed` marker is deliberately not here: the
 * sandbox pins that on its own log during restore (it is the transcript the operator reads while
 * lifted), and the descend's archive carries that marker home, displacing nothing.
 */
const appendRelocationNotice = async (ctx: LiftCtx): Promise<void> => {
  const { args } = ctx
  await args.localLog
    .append({
      threadId: args.threadId,
      runId: args.ids.nextRunId(),
      drafts: [
        ...ctx.stopped.drainNotices(),
        liftedDraft({ workspace: ctx.workspace, stopped: ctx.stopped }),
      ],
    })
    .catch((error: unknown) => {
      ctx.logPort?.warn({
        source: 'cloud.lift',
        message: 'the relocation notice never reached the local log',
        threadId: args.threadId,
        data: { operation: 'append-relocation-notice' },
        ...logFieldsOf({ error }),
      })
    })
}

export const liftPlan = (args: { midTurn: boolean }): RelocationPlan<LiftCtx> => [
  {
    id: ELiftNode.InterruptTurn,
    needs: [],
    ...(args.midTurn ? { label: 'interrupting the turn at a clean break' } : {}),
    run: async (ctx: LiftCtx) => {
      if (ctx.args.midTurn) {
        if (ctx.args.pause === undefined) ctx.args.interrupt()
        else ctx.args.pause()
      }
      const settled = await liftSettledBeforeDeadline(ctx.args)
      if (!settled) throw new Error('the turn would not stop in time — nothing moved')
    },
  },
  {
    id: ELiftNode.CaptureWorkspace,
    needs: [ELiftNode.PauseLoops],
    label: 'packing the uncommitted work',
    run: async (ctx) => {
      ctx.workspace = await ctx.args.capture({ cwd: ctx.args.cwd })
      ctx.workspaceArchive = await (ctx.args.captureWorkspaceArchive ?? captureLiftWorkspace)({ cwd: ctx.args.cwd })
    },
  },
  {
    id: ELiftNode.CaptureGpg,
    needs: [ELiftNode.InterruptTurn],
    run: async (ctx) => {
      const capture = ctx.args.captureGpg ?? exportGpgMaterial
      const material = await capture({ cwd: ctx.args.cwd }).catch((error: unknown) => {
        ctx.logPort?.warn({
          source: 'cloud.lift',
          message: 'the GPG key material could not be captured — signed commits will not work in the cloud',
          threadId: ctx.args.threadId,
          data: { operation: 'capture-gpg' },
          ...logFieldsOf({ error }),
        })
        return null
      })
      if (material !== null) ctx.gpgKey = JSON.stringify(material)
    },
  },
  {
    id: ELiftNode.PauseLoops,
    needs: [ELiftNode.InterruptTurn],
    label: 'closing what is running here',
    run: async (ctx) => {
      ctx.stopped = await ctx.args.stopLocal()
      ctx.pausedChildren = await ctx.args.agents.pauseChildren({ threadId: ctx.args.threadId })
      ctx.args.agents.forgetNotices({ threadId: ctx.args.threadId })
    },
  },
  {
    id: ELiftNode.StampModel,
    needs: [ELiftNode.InterruptTurn],
    run: async (ctx) => {
      await ctx.args.localThreads.chooseModel({ threadId: ctx.args.threadId, model: ctx.args.model })
    },
  },
  {
    id: ELiftNode.ArchiveSession,
    needs: [ELiftNode.PauseLoops, ELiftNode.StampModel],
    label: 'transferring the conversation',
    run: async (ctx) => {
      await ctx.args.localLog.refresh({ threadId: ctx.args.threadId })
      const family = [ctx.args.threadId]
      for (const threadId of family) {
        if (ctx.expected.has(threadId)) continue
        ctx.expected.set(threadId, await ctx.args.localLog.readOwn({ threadId }))
        const children = await ctx.args.localThreads.spawned({ threadId })
        family.push(...children.map((child) => child.id))
      }
      if (!ctx.args.started && [...ctx.expected.values()].every((events) => events.length === 0)) return
      ctx.transcript = await buildSessionArchive({
        sessionDir: sessionDirectory({ home: atlasDirectory(), sessionId: ctx.args.threadId }),
      })
      if (ctx.transcript === undefined && ctx.args.started) {
        throw new Error('the local transcript could not be archived — nothing moved')
      }
    },
  },
  {
    id: ELiftNode.Provision,
    needs: [ELiftNode.CaptureWorkspace, ELiftNode.CaptureGpg, ELiftNode.ArchiveSession],
    label: 'waiting for the sandbox',
    run: async (ctx) => {
      ctx.sandbox = await ctx.args.bridge.sandboxes.create({
        threadId: ctx.args.threadId,
        workspace: ctx.workspace,
        ...(ctx.workspaceArchive === undefined ? {} : { workspaceArchivePath: ctx.workspaceArchive.path }),
        model: ctx.args.model.ref,
        ...(ctx.transcript === undefined ? {} : { transcript: ctx.transcript }),
        ...(ctx.gpgKey === undefined ? {} : { gpgKey: ctx.gpgKey }),
        captureContext: async (put) => {
          ctx.onWaveLabel?.(ELiftNode.Provision, 'sending skills and memory to the sandbox')
          try {
            const archive = await ctx.args.captureContext()
            if (archive !== undefined) await put(archive)
          } catch (error) {
            ctx.contextError = error
            throw error
          } finally {
            ctx.onWaveLabel?.(ELiftNode.Provision, 'waiting for the sandbox')
          }
        },
      })
    },
  },
  {
    id: ELiftNode.ConfirmLanded,
    needs: [ELiftNode.Provision],
    run: async (ctx) => {
      if (ctx.transcript === undefined) return
      const reply = await ctx.args.bridge.sandboxes.confirmLanded({
        threadId: ctx.args.threadId,
      })
      if (!reply.landed) {
        throw new Error('the sandbox never confirmed the transcript landed — refusing the flip')
      }
    },
  },
  {
    id: ELiftNode.Restore,
    needs: [ELiftNode.ConfirmLanded],
    label: 'attaching and verifying the conversation',
    run: async (ctx) => {
      const sandbox = ctx.sandbox
      if (sandbox === undefined) throw new Error('the lift attached without its sandbox')
      const attachment = ctx.args.bridge.attach({ threadId: ctx.args.threadId, url: sandbox.url, token: sandbox.token })
      ctx.attachment = attachment
      ctx.channel = attachment.channel
      if (ctx.workspaceArchive !== undefined) {
        const applied = applyWorkspaceArchiveReplySchema.parse(await attachment.channel.request({
          op: EClientRequest.ApplyWorkspaceArchive,
          params: {},
        }))
        ctx.restoredWorkspace = applied.restored
      }
      if (ctx.transcript !== undefined) {
        const reply = await attachment.channel.request({
          op: EClientRequest.RestoreTranscript,
          params: {
            locationChanged: {
              from: ctx.from,
              to: EExecutionLocation.Cloud,
              cwd: ctx.restoredWorkspace?.cwd ?? CLOUD_WORKSPACE_PATH,
              remoteUrl: ctx.workspace?.remoteUrl ?? null,
              branch: ctx.workspace?.branch ?? null,
            },
          },
        })
        if (typeof reply !== 'object' || reply === null || !('restored' in reply) || reply.restored !== true) {
          throw new Error('serve did not restore the transcript — refusing the ownership flip')
        }
        await verifyTranscript({ attachment, expected: ctx.expected })
      }
    },
  },
  {
    id: ELiftNode.FlipOwnership,
    needs: [ELiftNode.Attach],
    commit: true,
    label: 'handing the conversation over',
    run: async (ctx) => {
      await ctx.transaction.commit({
        harness: EHarnessPlacement.Cloud,
        driveName: ctx.sandbox?.driveName,
      })
    },
  },
  {
    id: ELiftNode.Attach,
    needs: [ELiftNode.Restore],
    run: async (ctx) => {
      if (ctx.attachment === undefined) throw new Error('the verified cloud attachment is missing')
      await ctx.args.open?.({ attachment: ctx.attachment, transaction: ctx.transaction, restoredWorkspace: ctx.restoredWorkspace })
    },
  },
  {
    id: ELiftNode.ActivateFamily,
    needs: [ELiftNode.FlipOwnership],
    run: async (ctx) => {
      if (ctx.workspaceArchive !== undefined) {
        const activated = activateSessionReplySchema.parse(await ctx.channel?.request({ op: EClientRequest.ActivateSession, params: {} }))
        if (!activated.activated) throw new Error('the prepared cloud runtime could not be activated after ownership committed')
      }
      const { args } = ctx
      if (args.started && args.title !== null) await args.localThreads.rename({ threadId: args.threadId, title: args.title })
      await flipChildrenToCloud({
        threadId: args.threadId,
        ids: args.ids,
        agents: args.agents,
        localThreads: args.localThreads,
        localLog: args.localLog,
        logPort: ctx.logPort,
      })
    },
  },
  {
    id: ELiftNode.ResumePaused,
    needs: [ELiftNode.ActivateFamily],
    ...(args.midTurn ? { label: 'resuming the turn in the cloud' } : {}),
    run: async (ctx) => {
      await appendRelocationNotice(ctx)
    },
  },
  {
    id: ELiftNode.DestroyLocalWorktree,
    needs: [ELiftNode.ResumePaused],
    run: async (ctx) => {
      const archive = ctx.workspaceArchive
      if (archive === undefined || ctx.restoredWorkspace === undefined) return
      const tree = archive.manifest.trees.find((candidate) => candidate.id === archive.manifest.activeId)
      if (tree === undefined) return
      await destroyLiftedWorktree({
        cwd: ctx.args.cwd,
        expected: tree.fingerprint,
        logPort: ctx.logPort,
        threadId: ctx.args.threadId,
      }).catch((error: unknown) => {
        ctx.logPort?.warn({
          source: 'cloud.lift',
          message: 'the lifted local worktree could not be destroyed; it stays on disk',
          threadId: ctx.args.threadId,
          data: { operation: 'destroy-local-worktree' },
          ...logFieldsOf({ error }),
        })
      })
    },
  },
]
