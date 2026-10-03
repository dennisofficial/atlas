import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sendControl } from './control'
import { createHandle, readStatus, type DurableShellHandle, type HandleArgs } from './handle'
import {
  createExclusiveFile,
  ensurePrivateDirectory,
  messageOf,
  newControlToken,
  newDurableIdentity,
  pidNamespaceOf,
  readJsonFile,
  readTextFile,
  stampIsLive,
} from './identity'
import {
  CANCEL_FILE,
  CONFIG_FILE,
  DEFAULT_KILL_GRACE_MS,
  DEFAULT_LEASE_MS,
  DEFAULT_OUTPUT_LIMIT_BYTES,
  DEFAULT_SILENCE_MS,
  DEFAULT_START_TIMEOUT_MS,
  DEFAULT_TICK_MS,
  DEFAULT_TTL_MS,
  EControlError,
  EShellPhase,
  MAX_SOCKET_PATH_BYTES,
  META_FILE,
  metaSchema,
  SOCKET_FILE,
  TOKEN_FILE,
  type ControlResult,
  type ControlTransport,
  type ELeaseMode,
  type SessionLockClaim,
  type ShellMeta,
  type ShellStatus,
  type SupervisorConfig,
} from './protocol'

export { sendControl, pidNamespaceOf }
export type { DurableShellHandle }
export type { ShellOutcome, ShellSnapshot } from './handle'
export * from './protocol'

export enum EAttachFailure {
  Missing = 'missing',
  Invalid = 'invalid',
  IdentityMismatch = 'identity-mismatch',
  StartFailed = 'start-failed',
  Unreachable = 'unreachable',
}

export type AttachOutcome =
  | { ok: true; handle: DurableShellHandle }
  | { ok: false; code: EAttachFailure; reason: string }

export type AttachArgs = {
  shellDir: string
  cursor?: number | undefined
  transport?: ControlTransport | undefined
  leaseMode?: ELeaseMode | undefined
  pollMs?: number | undefined
  clientId?: string | undefined
}

export type LaunchSpec = { cmd: readonly string[]; cwd: string; env: Record<string, string> | undefined }

export type LaunchArgs = Omit<AttachArgs, 'clientId'> & {
  command: string
  cwd: string
  env?: Record<string, string | undefined> | undefined
  outputLimitBytes?: number | undefined
  ttlMs?: number | undefined
  timeoutMs?: number | undefined
  silenceMs?: number | undefined
  leaseMs?: number | undefined
  tickMs?: number | undefined
  killGraceMs?: number | undefined
  sessionLock?: SessionLockClaim | undefined
  supervisorCommand?: readonly string[] | undefined
  launch?: ((spec: LaunchSpec) => Promise<void>) | undefined
  startTimeoutMs?: number | undefined
}

export type Inspection = {
  meta?: ShellMeta | undefined
  status?: ShellStatus | undefined
  supervisorLive: boolean
  reason?: string | undefined
}

const SUPERVISOR_ENTRY = join(import.meta.dir, 'supervisor-main.ts')

export function defaultSupervisorCommand(): readonly string[] {
  return [process.execPath, SUPERVISOR_ENTRY]
}

export async function inspectDurableShell({ shellDir }: { shellDir: string }): Promise<Inspection> {
  const meta = await readJsonFile({ path: join(shellDir, META_FILE), schema: metaSchema })
  const status = await readStatus({ shellDir })
  if (!meta.ok) return { status, supervisorLive: false, reason: meta.reason }
  return { meta: meta.value, status, supervisorLive: await stampIsLive({ stamp: meta.value.supervisor }) }
}

const failed = (code: EAttachFailure, reason: string): AttachOutcome => ({ ok: false, code, reason })

export async function attachDurableShell(args: AttachArgs): Promise<AttachOutcome> {
  const status = await readStatus({ shellDir: args.shellDir })
  const metaRead = await readJsonFile({ path: join(args.shellDir, META_FILE), schema: metaSchema })
  const meta = metaRead.ok ? metaRead.value : undefined
  if (status === undefined && meta === undefined)
    return failed(metaRead.ok ? EAttachFailure.Missing : metaRead.missing ? EAttachFailure.Missing : EAttachFailure.Invalid, metaRead.ok ? 'no status' : metaRead.reason)
  if (status !== undefined && meta !== undefined && status.identity !== meta.identity)
    return failed(EAttachFailure.IdentityMismatch, 'status.json and meta.json disagree on the durable identity')
  const identity = status?.identity ?? meta?.identity ?? ''
  if (status?.phase === EShellPhase.StartFailed)
    return failed(EAttachFailure.StartFailed, status.failure ?? 'start failed')

  const base = {
    shellDir: args.shellDir,
    identity,
    pid: meta?.child.pid ?? 0,
    meta,
    cursor: args.cursor ?? 0,
    clientId: args.clientId ?? randomBytes(8).toString('hex'),
    pollMs: args.pollMs,
    transport: args.transport,
    leaseMode: args.leaseMode,
  }
  if (status?.exit !== undefined)
    return { ok: true, handle: createHandle({ ...base, token: undefined, terminal: status.exit, lostReason: undefined }) }

  const token = await readTextFile({ path: join(args.shellDir, TOKEN_FILE) })
  if (meta === undefined || !token.ok)
    return failed(EAttachFailure.Invalid, 'a running shell needs both meta.json and its control token to be controlled')

  const hello = await (args.transport ?? ((call) => sendControl({ directory: args.shellDir, ...call })))({
    request: { type: 'heartbeat' },
  })
  if (!hello.ok) return settleUnreachable({ args, base, hello })
  return { ok: true, handle: createHandle({ ...base, token: token.value.trim(), terminal: undefined, lostReason: undefined }) }
}

async function settleUnreachable({
  args,
  base,
  hello,
}: {
  args: AttachArgs
  base: Omit<HandleArgs, 'token' | 'terminal' | 'lostReason'>
  hello: ControlResult
}): Promise<AttachOutcome> {
  const reason = hello.ok ? '' : hello.message
  if (!hello.ok && (hello.code === EControlError.Unauthorized || hello.code === EControlError.IdentityMismatch))
    return failed(EAttachFailure.IdentityMismatch, reason)

  const status = await readStatus({ shellDir: args.shellDir })
  if (status?.exit !== undefined)
    return { ok: true, handle: createHandle({ ...base, token: undefined, terminal: status.exit, lostReason: undefined }) }

  const probed = await probeSupervisor({ args, base })
  if (!probed.ok || probed.probe === undefined || probed.probe.supervisorAlive)
    return failed(EAttachFailure.Unreachable, probed.ok ? reason : probed.message)
  return {
    ok: true,
    handle: createHandle({
      ...base,
      token: undefined,
      terminal: undefined,
      lostReason: 'the supervisor is gone without recording an exit; the shell may still be running',
    }),
  }
}

async function probeSupervisor({
  args,
  base,
}: {
  args: AttachArgs
  base: Omit<HandleArgs, 'token' | 'terminal' | 'lostReason'>
}): Promise<ControlResult> {
  try {
    if (args.transport === undefined)
      return {
        ok: true,
        probe: {
          supervisorAlive: base.meta !== undefined && (await stampIsLive({ stamp: base.meta.supervisor })),
          childAlive: false,
          reachable: false,
        },
      }
    return await args.transport({ request: { type: 'probe' } })
  } catch (error) {
    return { ok: false, code: EControlError.Unreachable, message: messageOf({ error }) }
  }
}

async function socketPathFor({ shellDir }: { shellDir: string }): Promise<string> {
  const inside = join(shellDir, SOCKET_FILE)
  if (Buffer.byteLength(inside) <= MAX_SOCKET_PATH_BYTES) return inside
  return join(await mkdtemp(join(tmpdir(), 'atlas-sock-')), SOCKET_FILE)
}

async function waitForStart({
  shellDir,
  timeoutMs,
}: {
  shellDir: string
  timeoutMs: number
}): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await readStatus({ shellDir })
    if (status?.phase === EShellPhase.Running || status?.phase === EShellPhase.Exited) return undefined
    if (status?.phase === EShellPhase.StartFailed) return status.failure ?? 'start failed'
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return 'timed out waiting for the supervisor to start the shell'
}

async function cancelStart({ args }: { args: LaunchArgs }): Promise<void> {
  await writeFile(join(args.shellDir, CANCEL_FILE), '', { mode: 0o600 }).catch(() => undefined)
  const send = args.transport ?? ((call) => sendControl({ directory: args.shellDir, ...call }))
  await send({ request: { type: 'kill' } }).catch(() => undefined)
  if (args.launch !== undefined) return
  const status = await readStatus({ shellDir: args.shellDir })
  if (status?.supervisor !== undefined && (await stampIsLive({ stamp: status.supervisor })) && status.phase === EShellPhase.Starting)
    process.kill(status.supervisor.pid, 'SIGTERM')
}

function launchEnv({ env }: { env: LaunchArgs['env'] }): Record<string, string> {
  const entries = Object.entries(env ?? process.env)
  return Object.fromEntries(entries.filter((entry): entry is [string, string] => entry[1] !== undefined))
}

async function spawnDetached({ cmd, cwd, env }: LaunchSpec): Promise<void> {
  const [executable, ...rest] = cmd
  if (executable === undefined) throw new Error('supervisorCommand is empty')
  const supervisor = spawn(executable, rest, { detached: true, stdio: 'ignore', cwd, env })
  supervisor.unref()
  await new Promise<void>((resolve, reject) => {
    supervisor.once('error', reject)
    supervisor.once('spawn', () => resolve())
  })
}

export async function launchDurableShell(args: LaunchArgs): Promise<AttachOutcome> {
  let owned = false
  try {
    await ensurePrivateDirectory({ path: args.shellDir })
    const config: SupervisorConfig = {
      version: 1,
      identity: newDurableIdentity(),
      shellDir: args.shellDir,
      socketPath: await socketPathFor({ shellDir: args.shellDir }),
      command: args.command,
      cwd: args.cwd,
      outputLimitBytes: args.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT_BYTES,
      ttlMs: args.ttlMs ?? DEFAULT_TTL_MS,
      ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
      silenceMs: args.silenceMs ?? DEFAULT_SILENCE_MS,
      leaseMs: args.leaseMs ?? DEFAULT_LEASE_MS,
      tickMs: args.tickMs ?? DEFAULT_TICK_MS,
      killGraceMs: args.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      ...(args.sessionLock === undefined ? {} : { sessionLock: args.sessionLock }),
    }
    await createExclusiveFile({ path: join(args.shellDir, TOKEN_FILE), data: newControlToken(), mode: 0o600 })
    owned = true
    const configPath = join(args.shellDir, CONFIG_FILE)
    await createExclusiveFile({ path: configPath, data: JSON.stringify(config), mode: 0o600 })

    const cmd = [...(args.supervisorCommand ?? defaultSupervisorCommand()), configPath]
    await (args.launch ?? spawnDetached)({ cmd, cwd: '/', env: launchEnv({ env: args.env }) })

    const failure = await waitForStart({ shellDir: args.shellDir, timeoutMs: args.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS })
    if (failure !== undefined) {
      await cancelStart({ args })
      return failed(EAttachFailure.StartFailed, failure)
    }
  } catch (error) {
    if (owned) await cancelStart({ args })
    return failed(EAttachFailure.StartFailed, messageOf({ error }))
  }
  try {
    const attached = await attachDurableShell(args)
    if (!attached.ok) await cancelStart({ args })
    return attached
  } catch (error) {
    await cancelStart({ args })
    return failed(EAttachFailure.StartFailed, messageOf({ error }))
  }
}
