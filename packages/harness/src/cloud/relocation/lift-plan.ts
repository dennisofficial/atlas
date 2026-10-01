import {
  CLOUD_WORKSPACE_PATH,
  EExecutionLocation,
  EHarnessPlacement,
  type Event,
  type LogPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { PlacementTransaction } from '../../composition/placement-controller'
import { buildSessionArchive } from '../session-archive'
import { EClientRequest } from '../channel-wire'
import { logFieldsOf } from '../../store/logs'
import { atlasDirectory } from '../../store/paths'
import { sessionDirectory } from '../../store/sessions/paths'
import { exportGpgMaterial } from '../../workspace/gpg-material'
import type { CloudAttachment, CloudChannel, CloudSandbox, LiftedWorkspace } from './cloud-bridge'
import { verifyTranscript } from './verify-transcript'
import type { RelocationPlan } from './dag'
import { flipChildrenToCloud } from './lift-children'
import { ELiftStep, type LiftArgs } from './lift'
import { liftedDraft, type StoppedLocally } from './transition-notice'

export enum ELiftNode {
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
  ResumePaused = 'resumePaused',
}

export type LiftCtx = {
  args: LiftArgs
  onProgress: (step: ELiftStep) => void
  logPort?: LogPort | undefined
  transaction: PlacementTransaction
  from: EExecutionLocation
  workspace: LiftedWorkspace | null
  gpgKey: string | undefined
  transcript: Uint8Array | undefined
  sandbox: CloudSandbox | undefined
  channel: CloudChannel | undefined
  attachment: CloudAttachment | undefined
  expected: Map<ThreadId, readonly Event[]>
  contextError: unknown
  stopped: StoppedLocally
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

export const liftPlan = (): RelocationPlan<LiftCtx> => [
  {
    id: ELiftNode.CaptureWorkspace,
    needs: [],
    run: async (ctx) => {
      ctx.workspace = await ctx.args.capture({ cwd: ctx.args.cwd })
      ctx.onProgress(ELiftStep.Capturing)
    },
  },
  {
    id: ELiftNode.CaptureGpg,
    needs: [],
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
    needs: [],
    run: async (ctx) => {
      ctx.onProgress(ELiftStep.Stopping)
      ctx.stopped = await ctx.args.stopLocal()
      await ctx.args.agents.pauseChildren({ threadId: ctx.args.threadId })
      ctx.args.agents.forgetNotices({ threadId: ctx.args.threadId })
    },
  },
  {
    id: ELiftNode.StampModel,
    needs: [],
    run: async (ctx) => {
      await ctx.args.localThreads.chooseModel({ threadId: ctx.args.threadId, model: ctx.args.model })
    },
  },
  {
    id: ELiftNode.ArchiveSession,
    needs: [ELiftNode.PauseLoops, ELiftNode.StampModel],
    run: async (ctx) => {
      ctx.onProgress(ELiftStep.Transferring)
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
    run: async (ctx) => {
      ctx.onProgress(ELiftStep.Starting)
      ctx.sandbox = await ctx.args.bridge.sandboxes.create({
        threadId: ctx.args.threadId,
        workspace: ctx.workspace,
        model: ctx.args.model.ref,
        ...(ctx.transcript === undefined ? {} : { transcript: ctx.transcript }),
        ...(ctx.gpgKey === undefined ? {} : { gpgKey: ctx.gpgKey }),
        captureContext: async (put) => {
          ctx.onProgress(ELiftStep.UploadingContext)
          try {
            const archive = await ctx.args.captureContext()
            if (archive !== undefined) await put(archive)
          } catch (error) {
            ctx.contextError = error
            throw error
          } finally {
            ctx.onProgress(ELiftStep.Starting)
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
    run: async (ctx) => {
      ctx.onProgress(ELiftStep.Attaching)
      const sandbox = ctx.sandbox
      if (sandbox === undefined) throw new Error('the lift attached without its sandbox')
      const attachment = ctx.args.bridge.attach({ threadId: ctx.args.threadId, url: sandbox.url, token: sandbox.token })
      ctx.attachment = attachment
      ctx.channel = attachment.channel
      if (ctx.transcript !== undefined) {
        const reply = await attachment.channel.request({
          op: EClientRequest.RestoreTranscript,
          params: {
            locationChanged: {
              from: ctx.from,
              to: EExecutionLocation.Cloud,
              cwd: CLOUD_WORKSPACE_PATH,
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
    needs: [ELiftNode.Restore],
    commit: true,
    run: async (ctx) => {
      const { args } = ctx
      await ctx.transaction.commit({
        harness: EHarnessPlacement.Cloud,
        driveName: ctx.sandbox?.driveName,
      })
      if (args.started && args.title !== null) {
        await args.localThreads.rename({ threadId: args.threadId, title: args.title })
      }
      await flipChildrenToCloud({
        threadId: args.threadId,
        ids: args.ids,
        agents: args.agents,
        localThreads: args.localThreads,
        localLog: args.localLog,
        logPort: ctx.logPort,
      })
      ctx.onProgress(ELiftStep.Flipping)
    },
  },
  {
    id: ELiftNode.Attach,
    needs: [ELiftNode.FlipOwnership],
    run: async (ctx) => {
      if (ctx.attachment === undefined) throw new Error('the verified cloud attachment is missing')
      await ctx.args.open?.(ctx.attachment)
    },
  },
  {
    id: ELiftNode.ResumePaused,
    needs: [ELiftNode.Attach],
    run: async (ctx) => {
      if (ctx.args.midTurn) ctx.onProgress(ELiftStep.Resuming)
      await appendRelocationNotice(ctx)
    },
  },
]
