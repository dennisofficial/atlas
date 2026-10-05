import type { EventDraft } from '../events/body'
import type { Event } from '../events/envelope'
import { EExecutionLocation } from '../execution/location'

export type ActiveWorktree = {
  path: string
  branch: string
  base: string | undefined
  adopted: boolean
}

const activeFrom = (body: {
  path: string
  branch: string
  base?: string | undefined
  adopted?: boolean | undefined
}): ActiveWorktree => ({
  path: body.path,
  branch: body.branch,
  base: body.base,
  adopted: body.adopted === true,
})

export function activeWorktreeOf(events: readonly Event[]): ActiveWorktree | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'worktree-exited') return undefined
    if (event?.type === 'directory-changed') return undefined
    if (event?.type === 'location-changed') return undefined
    if (event?.type === 'worktree-entered') return activeFrom(event)
  }

  return undefined
}

export function activeWorktreeAfter(args: {
  drafts: readonly EventDraft[]
  active: ActiveWorktree | undefined
}): ActiveWorktree | undefined {
  for (let index = args.drafts.length - 1; index >= 0; index -= 1) {
    const draft = args.drafts[index]
    if (draft?.type === 'worktree-exited') return undefined
    if (draft?.type === 'directory-changed') return undefined
    if (draft?.type === 'location-changed') return undefined
    if (draft?.type === 'worktree-entered') return activeFrom(draft)
  }

  return args.active
}

export function homeDirectoryOf(args: {
  events: readonly Event[]
  launchDirectory: string
}): string {
  let home = args.launchDirectory
  for (const event of args.events) {
    if (event.type === 'location-changed') home = event.cwd ?? args.launchDirectory
    if (event.type === 'worktree-exited' && event.returnTo !== undefined) home = event.returnTo
    if (event.type === 'directory-changed') home = event.path
  }
  return home
}

export function homeDirectoryAfter(args: {
  drafts: readonly EventDraft[]
  home: string
}): string {
  let home = args.home
  for (const draft of args.drafts) {
    if (draft.type === 'location-changed' && draft.cwd !== undefined) home = draft.cwd
    if (draft.type === 'worktree-exited' && draft.returnTo !== undefined) home = draft.returnTo
    if (draft.type === 'directory-changed') home = draft.path
  }
  return home
}

export function repoOf(args: {
  events: readonly Event[]
  launchRepo: string | null
}): string | null {
  for (let index = args.events.length - 1; index >= 0; index -= 1) {
    const event = args.events[index]
    if (event?.type === 'location-changed') return args.launchRepo
    if (event?.type === 'directory-changed' && event.repo !== undefined) return event.repo
  }
  return args.launchRepo
}

export function projectDirectoryOf(args: {
  events: readonly Event[]
  launchDirectory: string
}): string {
  return activeWorktreeOf(args.events)?.path ?? homeDirectoryOf(args)
}

export type LiftedGitIdentity = {
  remoteUrl: string
  branch: string
  cwd: string | undefined
}

/**
 * The git identity a lift recorded on its `location-changed`, or null when the thread is local
 * (or was lifted before the identity rode the event). A later transition back to local clears it,
 * so only the latest move decides. Worktree moves after the latest move to cloud override the
 * recorded branch and directory — the sandbox's session usually enters a worktree after arrival,
 * and the marker is a snapshot of the moment before that happened.
 */
export function liftedWorkspaceOf(events: readonly Event[]): LiftedGitIdentity | null {
  let anchor = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type !== 'location-changed') continue
    anchor = index
    break
  }
  if (anchor === -1) return null

  const lift = events[anchor]
  if (lift?.type !== 'location-changed') return null
  if (lift.to !== EExecutionLocation.Cloud) return null
  if (lift.remoteUrl == null || lift.branch == null) return null

  let branch = lift.branch
  let cwd = lift.cwd
  for (const event of events.slice(anchor + 1)) {
    if (event.type === 'worktree-entered') {
      branch = event.branch
      cwd = event.path
      continue
    }
    if (event.type === 'worktree-exited') {
      branch = lift.branch
      cwd = event.returnTo ?? lift.cwd
    }
  }

  return { remoteUrl: lift.remoteUrl, branch, cwd }
}
