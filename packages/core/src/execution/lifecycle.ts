export type LabelledSandbox = {
  id: string
  worktree: string | undefined
}

export function idleStopDue(args: {
  lastBashAt: number
  runningShells: number
  runningServices: number
  idleMinutes: number
  now: number
}): boolean {
  if (args.runningShells > 0) return false
  if (args.runningServices > 0) return false
  return args.now - args.lastBashAt >= args.idleMinutes * 60_000
}

/**
 * The serve-side park decision. Vercel only calls a sandbox idle — and stops billing for it — once
 * nothing inside runs, so an unattended serve must exit on its own. A live turn, settling children
 * or a background shell all hold the exit off indefinitely (the docker rule); services running with
 * an exposed port do not hold it off forever but stretch the TTL, since a preview the operator has
 * open should survive a coffee rather than a weekend.
 */
export function serveIdleDue(args: {
  lastActivityAt: number
  turnRunning: boolean
  childrenSettling: boolean
  runningShells: number
  runningServices: number
  idleMinutes: number
  idleMinutesWithServices: number
  now: number
}): boolean {
  if (args.turnRunning) return false
  if (args.childrenSettling) return false
  if (args.runningShells > 0) return false
  const ttlMinutes = args.runningServices > 0 ? args.idleMinutesWithServices : args.idleMinutes
  return args.now - args.lastActivityAt >= ttlMinutes * 60_000
}

export function staleSandboxes(args: {
  sandboxes: readonly LabelledSandbox[]
  worktrees: readonly string[]
  exists: (path: string) => boolean
}): readonly LabelledSandbox[] {
  const listed = new Set(args.worktrees)

  return args.sandboxes.filter((sandbox) => {
    if (sandbox.worktree === undefined) return false
    if (listed.has(sandbox.worktree)) return false
    return !args.exists(sandbox.worktree)
  })
}
