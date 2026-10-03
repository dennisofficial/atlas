import { constants } from 'node:os'

import { z } from 'zod'

export const SPOOL_FILE = 'spool.out'
export const META_FILE = 'meta.json'
export const STATUS_FILE = 'status.json'
export const CONFIG_FILE = 'config.json'
export const TOKEN_FILE = 'control.token'
export const SOCKET_FILE = 'control.sock'
export const CANCEL_FILE = 'cancel'
export const LEASE_DIR = 'leases'
export const LEASE_SUFFIX = '.lease'
export const SUPERVISOR_LOG_FILE = 'supervisor.log'

/**
 * RLIMIT_FSIZE bounds the size of every regular file any process in the shell's group may write, not
 * the spool's size alone: a build artifact, git pack or database past the cap dies with SIGXFSZ or
 * EFBIG exactly like the spool does. It does not bound pipes, sockets, terminals or total disk use.
 * bash's `ulimit -f` counts 1024-byte blocks, so the effective cap is rounded up to a whole KiB.
 */
export const DEFAULT_OUTPUT_LIMIT_BYTES = 5 * 1024 ** 3

export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000
export const DEFAULT_LEASE_MS = 30_000
export const DEFAULT_SILENCE_MS = 30 * 60 * 1000
export const DEFAULT_START_TIMEOUT_MS = 10_000
export const DEFAULT_POLL_MS = 250
export const HELLO_TIMEOUT_MS = 2_000
export const MAX_CONNECTIONS = 32
export const DEFAULT_TICK_MS = 10_000
export const DEFAULT_KILL_GRACE_MS = 5_000
export const MAX_FRAME_BYTES = 1024 * 1024
export const INPUT_WRITE_MAX_BYTES = 512 * 1024
export const INPUT_FRAME_BYTES = 64 * 1024
export const INPUT_BUFFER_BUDGET_BYTES = 1024 * 1024
export const REQUEST_TIMEOUT_MS = 5_000
export const SPOOL_READ_BYTES = 256 * 1024

export const LOST_EXIT_CODE = -1
export const ULIMIT_FAILED_EXIT = 125
export const CONTROL_FLAG = '--control'

// sun_path is 104 bytes on macOS and 108 on Linux, including the terminating NUL.
export const MAX_SOCKET_PATH_BYTES = 100

export enum EShellPhase {
  Starting = 'starting',
  Running = 'running',
  Exited = 'exited',
  StartFailed = 'start-failed',
}

export enum EExitCause {
  Natural = 'natural',
  Terminated = 'terminated',
  Killed = 'killed',
  Expired = 'expired',
  OutputLimit = 'output-limit',
  Timeout = 'timeout',
  Silence = 'silence',
}

export enum EOverflowEvidence {
  SpoolAtLimit = 'spool-at-limit',
  LeaderKilledBySigxfsz = 'leader-killed-by-sigxfsz',
}

export enum EShellSignal {
  Interrupt = 'SIGINT',
  Hangup = 'SIGHUP',
  Terminate = 'SIGTERM',
  Quit = 'SIGQUIT',
  User1 = 'SIGUSR1',
  User2 = 'SIGUSR2',
  Continue = 'SIGCONT',
  Stop = 'SIGSTOP',
  Kill = 'SIGKILL',
}

export enum ELeaseMode {
  Socket = 'socket',
  File = 'file',
}

export enum EControlError {
  Unauthorized = 'unauthorized',
  InvalidMessage = 'invalid-message',
  InputClosed = 'input-closed',
  InputBackpressure = 'input-backpressure',
  InputTooLarge = 'input-too-large',
  AlreadyExited = 'already-exited',
  Internal = 'internal',
  Unreachable = 'unreachable',
  TooManyConnections = 'too-many-connections',
  IdentityMismatch = 'identity-mismatch',
  Timeout = 'timeout',
}

export const processStampSchema = z.object({
  pid: z.number().int().positive(),
  start: z.string().optional(),
})

export type ProcessStamp = z.infer<typeof processStampSchema>

export const sessionLockClaimSchema = z.object({
  lockFile: z.string().min(1),
  pidNamespace: z.string().optional(),
})

export type SessionLockClaim = z.infer<typeof sessionLockClaimSchema>

export const supervisorConfigSchema = z.object({
  version: z.literal(1),
  identity: z.string().min(16),
  shellDir: z.string().min(1),
  socketPath: z.string().min(1),
  command: z.string(),
  cwd: z.string().min(1),
  outputLimitBytes: z.number().int().positive(),
  ttlMs: z.number().int().positive(),
  timeoutMs: z.number().int().positive().optional(),
  silenceMs: z.number().int().positive().optional(),
  leaseMs: z.number().int().positive(),
  tickMs: z.number().int().positive(),
  killGraceMs: z.number().int().positive(),
  sessionLock: sessionLockClaimSchema.optional(),
})

export type SupervisorConfig = z.infer<typeof supervisorConfigSchema>

export const metaSchema = z.object({
  version: z.literal(1),
  identity: z.string().min(16),
  command: z.string(),
  cwd: z.string(),
  createdAt: z.number(),
  supervisor: processStampSchema,
  child: processStampSchema,
  socketPath: z.string(),
  spoolPath: z.string(),
  outputLimitBytes: z.number().int().positive(),
  ttlMs: z.number().int().positive(),
  leaseMs: z.number().int().positive(),
})

export type ShellMeta = z.infer<typeof metaSchema>

export const exitRecordSchema = z.object({
  code: z.number().int().nullable(),
  signal: z.string().nullable(),
  exitCode: z.number().int(),
  cause: z.enum(EExitCause),
  endedAt: z.number(),
  spoolBytes: z.number().int().nonnegative(),
  limitBytes: z.number().int().positive(),
  overflowEvidence: z.array(z.enum(EOverflowEvidence)),
})

export type ExitRecord = z.infer<typeof exitRecordSchema>

export const statusSchema = z.object({
  version: z.literal(1),
  identity: z.string().min(16),
  phase: z.enum(EShellPhase),
  startedAt: z.number(),
  updatedAt: z.number(),
  lastAttachedAt: z.number(),
  lastClaimedAt: z.number(),
  supervisor: processStampSchema.optional(),
  failure: z.string().optional(),
  exit: exitRecordSchema.optional(),
})

export type ShellStatus = z.infer<typeof statusSchema>

const idField = z.number().int().nonnegative()

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), id: idField, token: z.string(), identity: z.string() }),
  z.object({ type: z.literal('heartbeat'), id: idField }),
  z.object({ type: z.literal('input'), id: idField, dataBase64: z.string() }),
  z.object({ type: z.literal('closeInput'), id: idField }),
  z.object({ type: z.literal('signal'), id: idField, signal: z.enum(EShellSignal) }),
  z.object({ type: z.literal('terminate'), id: idField }),
  z.object({ type: z.literal('kill'), id: idField }),
])

export type ClientMessage = z.infer<typeof clientMessageSchema>

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type ClientRequest = Exclude<DistributiveOmit<ClientMessage, 'id'>, { type: 'hello' }>

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello-ok'),
    id: idField,
    identity: z.string(),
    supervisor: processStampSchema,
    child: processStampSchema,
    leaseMs: z.number().int().positive(),
  }),
  z.object({ type: z.literal('ack'), id: idField }),
  z.object({
    type: z.literal('error'),
    id: idField,
    code: z.enum(EControlError),
    message: z.string(),
  }),
])

export type ServerMessage = z.infer<typeof serverMessageSchema>

export type ControlAction = ClientRequest | { type: 'probe' }

export const controlActionSchema: z.ZodType<ControlAction> = z.union([
  z.object({ type: z.literal('probe') }),
  z.object({ type: z.literal('heartbeat') }),
  z.object({ type: z.literal('input'), dataBase64: z.string() }),
  z.object({ type: z.literal('closeInput') }),
  z.object({ type: z.literal('signal'), signal: z.enum(EShellSignal) }),
  z.object({ type: z.literal('terminate') }),
  z.object({ type: z.literal('kill') }),
])

export type ProbeResult = {
  supervisorAlive: boolean
  childAlive: boolean
  reachable: boolean
}

export type ControlResult =
  | { ok: true; probe?: ProbeResult | undefined }
  | { ok: false; code: EControlError; message: string }

export type ControlTransport = (args: { request: ControlAction }) => Promise<ControlResult>

export function encodeFrame({ message }: { message: ClientMessage | ServerMessage }): string {
  return `${JSON.stringify(message)}\n`
}

export type DecodedFrames = { frames: unknown[]; error: string | undefined }

export class FrameDecoder {
  private buffer = ''

  push({ chunk }: { chunk: string }): DecodedFrames {
    this.buffer += chunk
    const frames: unknown[] = []
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline === -1) break
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (line.length === 0) continue
      try {
        frames.push(JSON.parse(line))
      } catch {
        return { frames, error: 'frame is not valid JSON' }
      }
    }
    if (this.buffer.length > MAX_FRAME_BYTES) return { frames, error: 'frame exceeds the size limit' }
    return { frames, error: undefined }
  }
}

export function exitCodeOf({ code, signal }: { code: number | null; signal: string | null }): number {
  if (code !== null) return code
  if (signal === null) return LOST_EXIT_CODE
  const number = Object.entries(constants.signals).find(([name]) => name === signal)?.[1]
  return 128 + (number ?? 0)
}
