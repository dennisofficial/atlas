import type { WorktreeLockIdentity } from '@dltech/atlas-core'

const START_TIME_ARGS = ['-o', 'lstart=', '-p'] as const

// proc(5): comm is paren-wrapped and may itself contain spaces or parens, so the
// fields after it start at the final ')'; starttime is field 22, i.e. index 19 of those.
export function parseProcStatStartTime(stat: string): string | undefined {
  const afterComm = stat.lastIndexOf(')')
  if (afterComm < 0) return undefined

  const fields = stat.slice(afterComm + 2).split(' ')
  const start = fields[19]
  return start !== undefined && /^\d+$/.test(start) ? start : undefined
}

async function procStartTimeOf({ pid }: { pid: number }): Promise<string | undefined> {
  try {
    return parseProcStatStartTime(await Bun.file(`/proc/${pid}/stat`).text())
  } catch {
    return undefined
  }
}

async function psStartTimeOf({ pid }: { pid: number }): Promise<string | undefined> {
  try {
    const ps = Bun.spawn(['ps', ...START_TIME_ARGS, String(pid)], {
      stdout: 'pipe',
      stderr: 'ignore',
      stdin: 'ignore',
    })
    const [stdout, status] = await Promise.all([new Response(ps.stdout).text(), ps.exited])
    if (status !== 0) return undefined

    const start = stdout.trim()
    return start.length === 0 ? undefined : start
  } catch {
    return undefined
  }
}

// Linux sandboxes ship without procps, so ps is missing there; the procfs read keeps the
// start time intact, which is what makes a recycled pid not read as a live lock holder.
export async function startTimeOf({ pid }: { pid: number }): Promise<string | undefined> {
  return (await psStartTimeOf({ pid })) ?? (await procStartTimeOf({ pid }))
}

export function isProcessAlive({ pid }: { pid: number }): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export async function ownIdentity(): Promise<WorktreeLockIdentity> {
  return { pid: process.pid, start: await startTimeOf({ pid: process.pid }) }
}

export async function holderIsLive({ pid, start }: WorktreeLockIdentity): Promise<boolean> {
  if (!isProcessAlive({ pid })) return false
  if (start === undefined) return true

  const current = await startTimeOf({ pid })
  return current === undefined ? true : current === start
}
