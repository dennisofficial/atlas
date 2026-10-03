import { mkdir, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { createSocketRequester } from './connection'
import { stampIsLive, readJsonFile, writeFileAtomic } from './identity'
import { createSpoolReader, createWaker, emptyStream, inertWaker, type SpoolEnd } from './output'
import {
  DEFAULT_POLL_MS,
  EControlError,
  ELeaseMode,
  EShellPhase,
  EShellSignal,
  LEASE_DIR,
  LEASE_SUFFIX,
  LOST_EXIT_CODE,
  SPOOL_FILE,
  STATUS_FILE,
  statusSchema,
  type ClientRequest,
  type ControlAction,
  type ControlResult,
  type ControlTransport,
  type ExitRecord,
  type ShellMeta,
  type ShellStatus,
} from './protocol'

const LIVENESS_CHECK_MS = 2_000

export type ShellOutcome =
  | { kind: 'exited'; exit: ExitRecord }
  | { kind: 'lost'; reason: string }
  | { kind: 'detached' }

export type ShellSnapshot = {
  pid: number
  identity: string
  phase: EShellPhase | 'lost'
  spoolOffset: number
  exit?: ExitRecord | undefined
  lostReason?: string | undefined
}

export type DurableShellHandle = {
  readonly pid: number
  readonly identity: string
  readonly shellDir: string
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  readonly exited: Promise<number>
  readonly settled: Promise<ShellOutcome>
  spoolOffset: () => number
  status: () => Promise<ShellStatus | undefined>
  snapshot: () => ShellSnapshot
  writeInput: (data: string | Uint8Array) => Promise<ControlResult>
  closeInput: () => Promise<ControlResult>
  signal: (signal: EShellSignal) => Promise<ControlResult>
  terminate: () => void
  kill: () => Promise<ControlResult>
  detach: () => Promise<void>
}

export type HandleArgs = {
  shellDir: string
  identity: string
  pid: number
  meta: ShellMeta | undefined
  token: string | undefined
  terminal: ExitRecord | undefined
  lostReason: string | undefined
  cursor: number
  clientId: string
  pollMs?: number | undefined
  transport?: ControlTransport | undefined
  leaseMode?: ELeaseMode | undefined
  livenessMs?: number | undefined
}

export async function readStatus({ shellDir }: { shellDir: string }): Promise<ShellStatus | undefined> {
  const read = await readJsonFile({ path: join(shellDir, STATUS_FILE), schema: statusSchema })
  return read.ok ? read.value : undefined
}

export function createHandle(args: HandleArgs): DurableShellHandle {
  const { shellDir, meta } = args
  const spoolPath = join(shellDir, SPOOL_FILE)
  const pollMs = args.pollMs ?? DEFAULT_POLL_MS
  const livenessMs = args.livenessMs ?? LIVENESS_CHECK_MS
  const leaseMode = args.leaseMode ?? (args.transport === undefined ? ELeaseMode.Socket : ELeaseMode.File)
  const controllable = args.terminal === undefined && args.lostReason === undefined
  const waker = controllable ? createWaker({ directory: shellDir, pollMs }) : inertWaker()
  const requester =
    controllable && args.transport === undefined && meta !== undefined && args.token !== undefined
      ? createSocketRequester({ socketPath: meta.socketPath, token: args.token, identity: args.identity })
      : undefined

  let outcome: ShellOutcome | undefined
  let latest: ShellStatus | undefined
  let settle: (value: ShellOutcome) => void = () => undefined
  const settled = new Promise<ShellOutcome>((resolve) => {
    settle = resolve
  })
  const exited = settled.then((value) => {
    if (value.kind === 'exited') return value.exit.exitCode
    if (value.kind === 'lost') return LOST_EXIT_CODE
    return new Promise<number>(() => undefined)
  })

  let heartbeat: ReturnType<typeof setTimeout> | undefined
  let inflight: Promise<void> = Promise.resolve()
  let leaseCleanup: Promise<void> = Promise.resolve()
  const leaseFile = join(shellDir, LEASE_DIR, `${args.clientId}${LEASE_SUFFIX}`)

  const finish = (value: ShellOutcome): void => {
    if (outcome !== undefined) return
    outcome = value
    clearTimeout(heartbeat)
    requester?.close()
    waker.close()
    if (leaseMode === ELeaseMode.File && controllable)
      leaseCleanup = inflight.then(() => rm(leaseFile, { force: true })).catch(() => undefined)
    settle(value)
  }

  const send = async (request: ControlAction): Promise<ControlResult> => {
    if (args.transport !== undefined) return args.transport({ request })
    if (requester === undefined || request.type === 'probe')
      return { ok: false, code: EControlError.Internal, message: 'no control channel' }
    return requester.request({ request })
  }

  const spool = createSpoolReader({
    spoolPath,
    cursor: args.cursor,
    waker,
    endOf: (): SpoolEnd => {
      if (outcome?.kind === 'exited') return { kind: 'ended', bytes: outcome.exit.spoolBytes }
      if (outcome !== undefined) return { kind: 'ended', bytes: undefined }
      return { kind: 'running' }
    },
    sizeOf: async () => (await stat(spoolPath).catch(() => undefined))?.size ?? 0,
  })

  const supervisorLive = async (): Promise<boolean | undefined> => {
    if (args.transport === undefined) {
      if (meta === undefined) return false
      return stampIsLive({ stamp: meta.supervisor }).catch(() => undefined)
    }
    const probed = await args.transport({ request: { type: 'probe' } }).catch(() => undefined)
    if (probed === undefined || !probed.ok || probed.probe === undefined) return undefined
    return probed.probe.supervisorAlive
  }

  let lastLivenessAt = Date.now()
  const observe = async (): Promise<ShellOutcome | undefined> => {
    latest = (await readStatus({ shellDir })) ?? latest
    if (latest?.exit !== undefined) return { kind: 'exited', exit: latest.exit }
    if (latest?.phase === EShellPhase.StartFailed)
      return { kind: 'lost', reason: latest.failure ?? 'the supervisor failed to start the shell' }
    if (Date.now() - lastLivenessAt < livenessMs) return undefined
    lastLivenessAt = Date.now()
    if ((await supervisorLive()) !== false) return undefined
    latest = (await readStatus({ shellDir })) ?? latest
    if (latest?.exit !== undefined) return { kind: 'exited', exit: latest.exit }
    return { kind: 'lost', reason: 'the supervisor is gone without recording an exit; the shell may still be running' }
  }

  const monitor = async (): Promise<void> => {
    while (outcome === undefined) {
      const found = await observe().catch(() => undefined)
      if (found !== undefined) return finish(found)
      await waker.wait()
    }
  }

  let sequence = 0
  const beat = async (): Promise<void> => {
    if (outcome !== undefined) return
    if (leaseMode === ELeaseMode.Socket) {
      await send({ type: 'heartbeat' })
      return
    }
    sequence += 1
    await mkdir(dirname(leaseFile), { recursive: true, mode: 0o700 }).catch(() => undefined)
    if (outcome !== undefined) return
    await writeFileAtomic({ path: leaseFile, data: String(sequence), mode: 0o600 }).catch(() => undefined)
  }

  if (args.terminal !== undefined) finish({ kind: 'exited', exit: args.terminal })
  else if (args.lostReason !== undefined) finish({ kind: 'lost', reason: args.lostReason })
  else {
    const beatMs = Math.max(1, Math.floor((meta?.leaseMs ?? 30_000) / 3))
    const runBeat = (): Promise<void> => {
      inflight = beat().catch(() => undefined)
      return inflight
    }
    const schedule = (): void => {
      if (outcome !== undefined) return
      heartbeat = setTimeout(() => void runBeat().then(schedule), beatMs)
      heartbeat.unref()
    }
    void runBeat().then(schedule)
    void monitor().catch(() => undefined)
  }

  const encode = (data: string | Uint8Array): ClientRequest => ({
    type: 'input',
    dataBase64: Buffer.from(data).toString('base64'),
  })

  const lostResult = (): ControlResult => ({
    ok: false,
    code: EControlError.Unreachable,
    message: 'the shell is no longer attached',
  })
  const guarded = (request: ControlAction): Promise<ControlResult> =>
    outcome === undefined ? send(request) : Promise.resolve(lostResult())

  return {
    pid: args.pid,
    identity: args.identity,
    shellDir,
    stdout: spool.stream,
    stderr: emptyStream(),
    exited,
    settled,
    spoolOffset: spool.offset,
    status: () => readStatus({ shellDir }),
    snapshot: () => ({
      pid: args.pid,
      identity: args.identity,
      phase:
        outcome?.kind === 'lost' ? 'lost' : outcome?.kind === 'exited' ? EShellPhase.Exited : (latest?.phase ?? EShellPhase.Running),
      spoolOffset: spool.offset(),
      exit: outcome?.kind === 'exited' ? outcome.exit : undefined,
      lostReason: outcome?.kind === 'lost' ? outcome.reason : undefined,
    }),
    writeInput: (data) => guarded(encode(data)),
    closeInput: () => guarded({ type: 'closeInput' }),
    signal: (signal) => guarded({ type: 'signal', signal }),
    terminate: () => void guarded({ type: 'terminate' }),
    kill: () => guarded({ type: 'kill' }),
    detach: async () => {
      finish({ kind: 'detached' })
      await leaseCleanup
    },
  }
}
