import { closeSync, fstatSync } from 'node:fs'
import { access, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { effectiveLimitBytes, signalGroup, spawnShellChild } from './child'
import { createControlServer, type ControlServer } from './control-server'
import { exitRecordOf, groupDrained, openSpool } from './exit-record'
import { createShellActions } from './shell-actions'
import { runControlCommand } from './control'
import {
  ensurePrivateDirectory,
  lockClaimIsActive,
  messageOf,
  readJsonFile,
  readTextFile,
  stampOf,
  writeFileAtomic,
} from './identity'
import { createLeaseTracker } from './lease'
import {
  CANCEL_FILE,
  CONTROL_FLAG,
  EExitCause,
  EShellPhase,
  META_FILE,
  SPOOL_FILE,
  STATUS_FILE,
  supervisorConfigSchema,
  TOKEN_FILE,
  type ShellMeta,
  type ShellStatus,
  type SupervisorConfig,
} from './protocol'
import { createStatusWriter } from './status-writer'

export { runControlCommand }

const START_FAILED_EXIT = 1
const BAD_ARGS_EXIT = 2

async function cancelRequested({ shellDir }: { shellDir: string }): Promise<boolean> {
  return access(join(shellDir, CANCEL_FILE)).then(
    () => true,
    () => false,
  )
}

async function superviseChild(config: SupervisorConfig): Promise<number> {
  let requested: EExitCause | undefined
  let pgid: number | undefined
  let exited = false
  let killTimer: ReturnType<typeof setTimeout> | undefined
  let ticker: ReturnType<typeof setInterval> | undefined
  let spoolClosed = false

  const requestStop = (cause: EExitCause): void => {
    if (exited) return
    requested ??= cause
    if (pgid === undefined) return
    signalGroup({ pgid, signal: 'SIGTERM' })
    const group = pgid
    killTimer ??= setTimeout(() => signalGroup({ pgid: group, signal: 'SIGKILL' }), config.killGraceMs)
  }
  const requestKill = (cause: EExitCause): void => {
    if (exited) return
    requested ??= cause
    if (pgid !== undefined) signalGroup({ pgid, signal: 'SIGKILL' })
  }
  const handleSignal = (): void => requestStop(EExitCause.Terminated)
  process.on('SIGTERM', handleSignal)
  process.on('SIGHUP', () => undefined)

  const startedAt = Date.now()
  const limitBytes = effectiveLimitBytes({ limitBytes: config.outputLimitBytes })
  const token = await readTextFile({ path: join(config.shellDir, TOKEN_FILE) })
  const supervisorStamp = await stampOf({ pid: process.pid })
  const spoolFd = openSpool({ shellDir: config.shellDir })
  const closeSpool = (): void => {
    if (spoolClosed) return
    spoolClosed = true
    closeSync(spoolFd)
  }
  const writer = createStatusWriter({
    path: join(config.shellDir, STATUS_FILE),
    initial: {
      version: 1,
      identity: config.identity,
      phase: EShellPhase.Starting,
      startedAt,
      updatedAt: startedAt,
      lastAttachedAt: startedAt,
      lastClaimedAt: startedAt,
      supervisor: supervisorStamp,
    },
  })

  const failStart = async (reason: string): Promise<number> => {
    closeSpool()
    process.off('SIGTERM', handleSignal)
    await writer.update({ phase: EShellPhase.StartFailed, failure: reason })
    return START_FAILED_EXIT
  }

  if (!token.ok) return failStart(`control token unreadable: ${token.reason}`)
  await writer.update({})
  if (requested !== undefined || (await cancelRequested({ shellDir: config.shellDir })))
    return failStart('start was cancelled by the launcher')
  const spawned = await spawnShellChild({ command: config.command, cwd: config.cwd, limitBytes, spoolFd })
  if (!spawned.ok) return failStart(spawned.reason)

  const { child, pid: childPid, ended: finished } = spawned
  pgid = childPid
  void finished.then(() => {
    exited = true
    clearInterval(ticker)
    clearTimeout(killTimer)
  })
  if (requested !== undefined) requestStop(requested)

  const lease = createLeaseTracker({ shellDir: config.shellDir, startedAt })
  const actions = createShellActions({
    child,
    pgid: childPid,
    touch: lease.touch,
    isExited: () => exited,
    requestStop,
    requestKill,
  })

  let server: ControlServer | undefined
  try {
    const childStamp = await stampOf({ pid: childPid })
    server = createControlServer({
      identity: config.identity,
      token: token.value.trim(),
      supervisor: supervisorStamp,
      child: childStamp,
      leaseMs: config.leaseMs,
      actions,
    })
    await ensurePrivateDirectory({ path: dirname(config.socketPath) })
    await server.listen({ path: config.socketPath })
    const meta: ShellMeta = {
      version: 1,
      identity: config.identity,
      command: config.command,
      cwd: config.cwd,
      createdAt: startedAt,
      supervisor: supervisorStamp,
      child: childStamp,
      socketPath: config.socketPath,
      spoolPath: join(config.shellDir, SPOOL_FILE),
      outputLimitBytes: limitBytes,
      ttlMs: config.ttlMs,
      leaseMs: config.leaseMs,
    }
    await writeFileAtomic({ path: join(config.shellDir, META_FILE), data: JSON.stringify(meta), mode: 0o600 })
    await writer.update({ phase: EShellPhase.Running })
  } catch (error) {
    signalGroup({ pgid: childPid, signal: 'SIGKILL' })
    await finished
    await server?.close()
    return failStart(`supervisor setup failed: ${messageOf({ error })}`)
  }

  let ticking = false
  const tick = async (): Promise<void> => {
    if (exited || ticking) return
    ticking = true
    try {
      await lease.scan()
      const claimed = config.sessionLock !== undefined && (await lockClaimIsActive({ claim: config.sessionLock }))
      if (exited) return
      const now = Date.now()
      const status = writer.current()
      const attachedAt = Math.max(status.lastAttachedAt, lease.lastTouchAt())
      const claimedAt = claimed ? now : status.lastClaimedAt
      if (attachedAt !== status.lastAttachedAt || claimedAt !== status.lastClaimedAt)
        await writer.update({ lastAttachedAt: attachedAt, lastClaimedAt: claimedAt })

      const lastOutputAt = Math.max(startedAt, fstatSync(spoolFd).mtimeMs)
      const cancelled = await cancelRequested({ shellDir: config.shellDir })
      if (exited || requested !== undefined) return
      if (cancelled) requestKill(EExitCause.Killed)
      else if (config.timeoutMs !== undefined && now - startedAt > config.timeoutMs) requestStop(EExitCause.Timeout)
      else if (config.silenceMs !== undefined && now - lastOutputAt > config.silenceMs) requestStop(EExitCause.Silence)
      else if (now - Math.max(attachedAt, claimedAt) > config.ttlMs) requestStop(EExitCause.Expired)
    } finally {
      ticking = false
    }
  }
  if (!exited) ticker = setInterval(() => void tick().catch(() => undefined), config.tickMs)

  try {
    const { code, signal } = await finished
    signalGroup({ pgid: childPid, signal: 'SIGKILL' })
    await groupDrained({ pgid: childPid })
    const record = exitRecordOf({ code, signal, requested, spoolBytes: fstatSync(spoolFd).size, limitBytes })
    closeSpool()
    await writer.update({ phase: EShellPhase.Exited, exit: record })
    return 0
  } finally {
    process.off('SIGTERM', handleSignal)
    await server.close()
  }
}

async function removeSocketDirectory({ config }: { config: SupervisorConfig }): Promise<void> {
  const directory = dirname(config.socketPath)
  if (directory === config.shellDir) return
  await rm(directory, { recursive: true, force: true }).catch(() => undefined)
}

export async function runShellSupervisor(args: readonly string[]): Promise<number> {
  if (args[0] === CONTROL_FLAG) return runControlCommand({ args })
  const configPath = args[0]
  if (configPath === undefined) return BAD_ARGS_EXIT

  const loaded = await readJsonFile({ path: configPath, schema: supervisorConfigSchema })
  if (!loaded.ok) return BAD_ARGS_EXIT
  const config = loaded.value
  try {
    await ensurePrivateDirectory({ path: config.shellDir })
    return await superviseChild(config)
  } catch (error) {
    process.stderr.write(`supervisor failed: ${messageOf({ error })}\n`)
    return START_FAILED_EXIT
  } finally {
    await removeSocketDirectory({ config })
  }
}

export type { ShellStatus }
