import { CloudError } from '../cloud-transport'
import { GitCredentialError } from '../gh-auth-token'
import { VercelNotConfiguredError } from '../vercel-credentials'
import type { RelocationRun } from './dag'
import { ELiftFault, ELiftStep, type LiftArgs, type LiftFailure } from './lift'
import { ELiftNode, type LiftCtx } from './lift-plan'
import type { StoppedLocally } from './transition-notice'

export const liftErrorDetail = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const faultOf = (args: { error: unknown; fallback: ELiftFault }): ELiftFault => {
  if (args.error instanceof VercelNotConfiguredError) return ELiftFault.NotConfigured
  if (args.error instanceof GitCredentialError) return ELiftFault.GitAuth
  if (!(args.error instanceof CloudError)) return args.fallback
  if (args.error.status === 503 && args.error.message.includes('not configured')) return ELiftFault.NotConfigured
  if (args.error.status === 0) return ELiftFault.Unreachable
  if (args.error.status === 413) return ELiftFault.PatchTooLarge
  return args.fallback
}

export const liftFailureOf = (args: {
  error: unknown
  step: ELiftStep
  fallback: ELiftFault
  stopped: StoppedLocally
}): LiftFailure => ({
  ok: false,
  fault: faultOf(args),
  step: args.step,
  detail: liftErrorDetail(args.error),
  stopped: args.stopped,
})

export async function liftSettledBeforeDeadline(args: LiftArgs): Promise<boolean> {
  const deadlineMs = args.interruptDeadlineMs ?? 30_000
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), deadlineMs) })
  try {
    return await Promise.race([args.whenSettled().then(() => true), expired])
  } finally {
    clearTimeout(timer)
  }
}

export function liftFailureOfRun(args: {
  run: Extract<RelocationRun, { ok: false }>
  ctx: LiftCtx
}): LiftFailure {
  const { run, ctx } = args
  if (ctx.contextError !== undefined) {
    return liftFailureOf({ error: ctx.contextError, step: ELiftStep.UploadingContext, fallback: ELiftFault.Context, stopped: ctx.stopped })
  }
  const step = run.failed === ELiftNode.CaptureWorkspace
    ? ELiftStep.Capturing
    : run.failed === ELiftNode.Restore || run.failed === ELiftNode.Attach || run.failed === ELiftNode.ResumePaused
      ? ELiftStep.Attaching
      : run.failed === ELiftNode.ArchiveSession ? ELiftStep.Transferring : ELiftStep.Starting
  return liftFailureOf({ error: run.error, step, fallback: run.failed === ELiftNode.CaptureWorkspace ? ELiftFault.Transfer : ELiftFault.Sandbox, stopped: ctx.stopped })
}
