import { spawn, type ChildProcess } from 'node:child_process'

import { ULIMIT_FAILED_EXIT } from './protocol'

const POSIX_SENSITIVE_ENV = ['POSIXLY_CORRECT', 'SHELLOPTS']

/**
 * bash's `ulimit -f` counts 1024-byte blocks, but 512-byte blocks under POSIX mode; the prelude and the
 * environment scrub keep the unit at 1024 so a 5 GiB cap is not silently halved.
 * The limit is set before the command runs and as both soft and hard, so the command cannot raise it.
 */
export function blocksFor({ limitBytes }: { limitBytes: number }): number {
  return Math.ceil(limitBytes / 1024)
}

export function scriptFor({ command, limitBytes }: { command: string; limitBytes: number }): string {
  const prelude = `set +o posix 2>/dev/null; ulimit -f ${blocksFor({ limitBytes })} || exit ${ULIMIT_FAILED_EXIT}`
  return `${prelude}\n${command}`
}

export function effectiveLimitBytes({ limitBytes }: { limitBytes: number }): number {
  return blocksFor({ limitBytes }) * 1024
}

export type ChildEnd = { code: number | null; signal: NodeJS.Signals | null }

export type SpawnedChild =
  | { ok: true; child: ChildProcess; pid: number; ended: Promise<ChildEnd> }
  | { ok: false; reason: string }

export function spawnShellChild({
  command,
  cwd,
  limitBytes,
  spoolFd,
}: {
  command: string
  cwd: string
  limitBytes: number
  spoolFd: number
}): Promise<SpawnedChild> {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const name of POSIX_SENSITIVE_ENV) delete env[name]

  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', scriptFor({ command, limitBytes })], {
      cwd,
      env,
      detached: true,
      stdio: ['pipe', spoolFd, spoolFd],
    })
    const ended = new Promise<ChildEnd>((done) => child.once('exit', (code, signal) => done({ code, signal })))
    child.stdin?.on('error', () => undefined)
    child.once('error', (error) => resolve({ ok: false, reason: error.message }))
    child.once('spawn', () => {
      if (child.pid === undefined) return resolve({ ok: false, reason: 'spawn produced no pid' })
      resolve({ ok: true, child, pid: child.pid, ended })
    })
  })
}

export function signalGroup({ pgid, signal }: { pgid: number; signal: NodeJS.Signals | 0 }): boolean {
  if (pgid <= 1 || pgid === process.pid) return false
  try {
    process.kill(-pgid, signal)
    return true
  } catch {
    return false
  }
}
