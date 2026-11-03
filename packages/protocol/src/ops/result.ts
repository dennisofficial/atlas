import { z } from 'zod'

export enum ECallStatus {
  Ok = 'ok',
  Failed = 'failed',
}

export enum ECallFailure {
  NotFound = 'not-found',
  PermissionDenied = 'permission-denied',
  AlreadyExists = 'already-exists',
  NotADirectory = 'not-a-directory',
  IsADirectory = 'is-a-directory',
  NotEmpty = 'not-empty',
  InvalidInput = 'invalid-input',
  SpawnFailed = 'spawn-failed',
  OutputLost = 'output-lost',
  Cancelled = 'cancelled',
  PersistFailed = 'persist-failed',
  Internal = 'internal',
}

export const callFailureSchema = z
  .object({ code: z.enum(ECallFailure), message: z.string() })
  .strict()

export type CallFailure = z.infer<typeof callFailureSchema>

export class CallFailureError extends Error {
  constructor(readonly failure: CallFailure) {
    super(failure.message)
  }
}

const ERRNO_FAILURES: Readonly<Record<string, ECallFailure>> = {
  ENOENT: ECallFailure.NotFound,
  EACCES: ECallFailure.PermissionDenied,
  EPERM: ECallFailure.PermissionDenied,
  EEXIST: ECallFailure.AlreadyExists,
  ENOTDIR: ECallFailure.NotADirectory,
  EISDIR: ECallFailure.IsADirectory,
  ENOTEMPTY: ECallFailure.NotEmpty,
  EINVAL: ECallFailure.InvalidInput,
}

const errnoOf = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

export const callFailureOf = (error: unknown): CallFailure => {
  if (error instanceof CallFailureError) return error.failure
  const message = error instanceof Error ? error.message : String(error)
  const errno = errnoOf(error)
  const code = errno === undefined ? undefined : ERRNO_FAILURES[errno]
  return { code: code ?? ECallFailure.Internal, message }
}

export const okResultSchema = <const K extends string, V extends z.ZodType>(args: {
  op: K
  value: V
}) =>
  z
    .object({ status: z.literal(ECallStatus.Ok), op: z.literal(args.op), value: args.value })
    .strict()

export const failedCallResultSchema = z
  .object({
    status: z.literal(ECallStatus.Failed),
    op: z.string().min(1),
    error: callFailureSchema,
  })
  .strict()

export type FailedCallResult = z.infer<typeof failedCallResultSchema>
