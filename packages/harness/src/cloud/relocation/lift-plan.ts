import {
  CLOUD_WORKSPACE_PATH,
  EExecutionLocation,
  EHarnessPlacement,
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
import type { CloudChannel, CloudSandbox, LiftedWorkspace } from './cloud-bridge'
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
  ShipSession = 'shipSession',
  ConfirmLanded = 'confirmLanded',
  FlipOwnership = 'flipOwnership',
  Attach = 'attach',
  ResumePaused = 'resumePaused',
}

export type LiftCtx = {
  args: LiftArgs
  onProgress: (step: ELiftStep) => void
  logPort?: LogPort | undefined
  /** The controller's commit seam: the durable placement flips here, once, after the transcript landed. */
  transaction: PlacementTransaction
  from: EExecutionLocation
  workspace: LiftedWorkspace | null
  gpgKey: string | undefined
  transcript: Uint8Array | undefined
  sandbox: CloudSandbox | undefined
  channel: CloudChannel | undefined
  contextError: unknown
  stopped: StoppedLocally
}

/**
 * The relocation notices land in the local log after the archive shipped, so the copy the sandbox
 * serves does not carry them — the descend's own relocation marker closes the trail on the way
 * back. They are for whoever opens the local transcript between the flip and the move.
 */
const appendRelocationNotice = async (ctx: LiftCtx): Promise<void> => {
  const { args } = ctx
  await args.localLog
    .append({
      threadId: args.threadId,
      runId: args.ids.nextRunId(),
      drafts: [
        ...ctx.stopped.drainNotices(),
        {
          type: 'location-changed',
          from: ctx.from,
          to: EExecutionLocation.Cloud,
          cwd: CLOUD_WORKSPACE_PATH,
          remoteUrl: ctx.workspace?.remoteUrl ?? null,
          branch: ctx.workspace?.branch ?? null,
        },
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
      // Paused children ride the session archive to the sandbox, whose serve re-enters their loops
      // from the transferred logs (adoptChildren) — they are not resumed on this machine.
      await ctx.args.agents.pauseChildren({ threadId: ctx.args.threadId })
      ctx.args.agents.forgetNotices({ threadId: ctx.args.threadId })
    },
  },
  {
    id: ELiftNode.StampModel,
    needs: [],
    run: async (ctx) => {
      // The footer selection can live nowhere but ctx.args.model, and the archive reads the
      // session dir from disk — the meta write must land first or the cloud thread boots on a
      // stale model.
      await ctx.args.localThreads.chooseModel({ threadId: ctx.args.threadId, model: ctx.args.model })
    },
  },
  {
    id: ELiftNode.ArchiveSession,
    needs: [ELiftNode.PauseLoops, ELiftNode.StampModel],
    run: async (ctx) => {
      ctx.onProgress(ELiftStep.Transferring)
      ctx.transcript = await buildSessionArchive({
        sessionDir: sessionDirectory({ home: atlasDirectory(), sessionId: ctx.args.threadId }),
      })
    },
  },
  {
    id: ELiftNode.Provision,
    needs: [ELiftNode.CaptureWorkspace, ELiftNode.CaptureGpg],
    run: async (ctx) => {
      ctx.onProgress(ELiftStep.Starting)
      ctx.sandbox = await ctx.args.bridge.sandboxes.create({
        threadId: ctx.args.threadId,
        workspace: ctx.workspace,
        model: ctx.args.model.ref,
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
    id: ELiftNode.ShipSession,
    needs: [ELiftNode.ArchiveSession, ELiftNode.Provision],
    run: async (ctx) => {
      if (ctx.transcript === undefined) return
      await ctx.args.bridge.sandboxes.putTranscript({
        threadId: ctx.args.threadId,
        archive: ctx.transcript,
      })
    },
  },
  {
    id: ELiftNode.ConfirmLanded,
    needs: [ELiftNode.ShipSession],
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
    id: ELiftNode.FlipOwnership,
    needs: [ELiftNode.ConfirmLanded],
    commit: true,
    run: async (ctx) => {
      const { args } = ctx
      // Unconditional: the local meta is the pointer every later boot reads to route this thread
      // to the attach path, so an unstarted /new thread must record the move too — the store
      // materializes the record for one it has never written.
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
      const { args } = ctx
      ctx.onProgress(ELiftStep.Attaching)
      const sandbox = ctx.sandbox
      if (sandbox === undefined) throw new Error('the lift attached without its sandbox')
      const attachment = args.bridge.attach({ threadId: args.threadId, url: sandbox.url, token: sandbox.token })
      ctx.channel = attachment.channel

      // The transcript shipped to an already-healthy serve, so boot never re-materialized it —
      // tell serve to extract the archive and re-read its store before the conversation opens.
      // A serve old enough to refuse reads as a blank transcript, so warn rather than attach one
      // silently.
      if (ctx.transcript !== undefined) {
        try {
          await attachment.channel.request({ op: EClientRequest.RestoreTranscript, params: {} })
        } catch (error) {
          ctx.logPort?.warn({
            source: 'cloud.lift',
            message: 'the serve did not restore the lifted transcript — the cloud transcript may open blank',
            threadId: args.threadId,
            data: { operation: 'restore-transcript' },
            ...logFieldsOf({ error }),
          })
        }
      }

      await args.open?.(attachment)
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
