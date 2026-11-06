import type { ThreadId } from '../events/ids'

export type SpawnCommand = {
  readonly cmd: readonly string[]
  readonly cwd: string
  readonly env?: Record<string, string | undefined> | undefined
  readonly threadId?: ThreadId | undefined
}

export enum EProcessOutcome {
  Exited = 'exited',
  Failed = 'failed',
  OomKilled = 'oom-killed',
  Interrupted = 'interrupted',
}

export type ProcessOutcome =
  | { readonly kind: EProcessOutcome.Exited; readonly code: number }
  | { readonly kind: EProcessOutcome.Failed; readonly code: string; readonly message: string }
  | { readonly kind: EProcessOutcome.OomKilled }
  | { readonly kind: EProcessOutcome.Interrupted }

export type ProcessHandle = {
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly exited: Promise<number>
  readonly outcome?: Promise<ProcessOutcome>
  terminate(): void
}

export const outcomeOf = (handle: ProcessHandle): Promise<ProcessOutcome> =>
  handle.outcome ?? handle.exited.then((code) => ({ kind: EProcessOutcome.Exited, code }))

export type PortExposure = {
  readonly containerPort: number
  readonly hostPort: number
  readonly url: string
}

export type PortExposureOutcome =
  | { ok: true; exposure: PortExposure }
  | { ok: false; reason: string }

export abstract class ProcessPort {
  abstract spawn(args: SpawnCommand): ProcessHandle

  abstract which(args: { command: string; threadId?: ThreadId | undefined }): string | null

  launchDetached?(args: SpawnCommand): Promise<void>

  vendored?(args: { command: string; threadId?: ThreadId | undefined }): Promise<string | null>

  exposePort?(args: {
    containerPort: number
    threadId?: ThreadId | undefined
  }): Promise<PortExposureOutcome>
}
