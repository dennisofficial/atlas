import type { EventDraft } from '@dltech/atlas-core'

import type { LiftedWorkspace } from './cloud-bridge'

export const CLOUD_NOTICE_SLOT = 'session'

export const CLOUD_NOTICE_KEY = 'execution-location'

export type StoppedLocally = {
  shells: readonly string[]
  services: readonly string[]
  drainNotices: () => readonly EventDraft[]
}

const NO_ENDINGS: readonly EventDraft[] = Object.freeze([])

export const NOTHING_WAS_STOPPED: StoppedLocally = Object.freeze({
  shells: Object.freeze([]),
  services: Object.freeze([]),
  drainNotices: () => NO_ENDINGS,
})

const plural = (args: { count: number; one: string; many: string }): string =>
  `${args.count} ${args.count === 1 ? args.one : args.many}`

const named = (labels: readonly string[]): string => ` (${labels.join(', ')})`

const closedSentence = (stopped: StoppedLocally): string => {
  const parts: string[] = []
  if (stopped.shells.length > 0) {
    parts.push(
      `${plural({ count: stopped.shells.length, one: 'background shell', many: 'background shells' })}${named(stopped.shells)}`,
    )
  }
  if (stopped.services.length > 0) {
    parts.push(
      `${plural({ count: stopped.services.length, one: 'service', many: 'services' })}${named(stopped.services)}`,
    )
  }

  if (parts.length === 0) {
    return 'Nothing was running locally, so the move closed nothing.'
  }

  return `Moving closed ${parts.join(' and ')} — start anything you still need again here.`
}

const NO_REPOSITORY =
  'There was no git repository behind the old working directory, so the sandbox starts with an empty one.'

const CARRY_RULE =
  'Work on the checked-out branch here — a descend carries only it, and refuses to come home while side branches or nested worktrees hold work it cannot carry.'

const rebuiltSentence = (workspace: LiftedWorkspace | null): string => {
  if (workspace === null) return NO_REPOSITORY

  const at = workspace.commit === null ? 'the checkout it was launched from' : workspace.commit
  const on = workspace.branch === null ? '' : ` on ${workspace.branch}`
  const from = workspace.remoteUrl === null ? '' : ` from ${workspace.remoteUrl}`

  if (workspace.patch.length === 0) {
    return `The workspace was rebuilt here${from}${on} at ${at}, with nothing uncommitted to carry.`
  }

  return `The workspace was rebuilt here${from}${on} at ${at}, and the uncommitted work — tracked edits and untracked files alike — came along as uncommitted changes, so git status here reads exactly like the machine the operator left.`
}

/**
 * What the model reads about its own relocation. The session moved machines mid-conversation and
 * nothing else in the transcript would ever say so, which is the whole reason this is prose in the
 * log rather than a silent column update.
 */
export const liftedProse = (args: {
  workspace: LiftedWorkspace | null
  stopped: StoppedLocally
}): string =>
  [
    'This session has moved: it now runs in a cloud sandbox rather than on the operator’s machine.',
    rebuiltSentence(args.workspace),
    args.workspace === null ? null : CARRY_RULE,
    closedSentence(args.stopped),
  ]
    .filter((sentence) => sentence !== null)
    .join(' ')

export const liftedDraft = (args: {
  workspace: LiftedWorkspace | null
  stopped: StoppedLocally
}): EventDraft => ({
  type: 'context-loaded',
  slot: CLOUD_NOTICE_SLOT,
  key: CLOUD_NOTICE_KEY,
  content: liftedProse(args),
})

/**
 * The mirror image on the way down, spoken only when the merge could not settle everything
 * itself: the files named carry ordinary conflict markers, and the model resuming locally needs
 * to know its tree has them.
 */
export const descendedConflictsDraft = (args: {
  conflicts: readonly string[]
}): EventDraft => ({
  type: 'context-loaded',
  slot: CLOUD_NOTICE_SLOT,
  key: CLOUD_NOTICE_KEY,
  content: [
    'This session has moved: it now runs on the operator’s machine again, and the cloud workspace came with it as uncommitted changes.',
    `${plural({ count: args.conflicts.length, one: 'One file', many: `${args.conflicts.length} files` })} had been edited on both sides and now ${args.conflicts.length === 1 ? 'carries' : 'carry'} ordinary git conflict markers: ${args.conflicts.join(', ')}.`,
    'Nothing else is blocked — resolve them whenever.',
  ].join(' '),
})

/**
 * Spoken when origin's branch tip moved while the session was away — work shipped from the cloud,
 * or the operator pushed elsewhere — and the host checkout holds nothing the origin does not. The
 * descend never discards on its own say-so: it names the discard and leaves the call to the
 * operator.
 */
export const descendedSupersededDraft = (args: {
  superseded: { branch: string; localTip: string; originTip: string }
}): EventDraft => ({
  type: 'context-loaded',
  slot: CLOUD_NOTICE_SLOT,
  key: CLOUD_NOTICE_KEY,
  content: [
    'This session has moved: it now runs on the operator’s machine again, and the cloud workspace came with it as uncommitted changes.',
    `While it was away, origin/${args.superseded.branch} moved to ${args.superseded.originTip.slice(0, 12)} and the host checkout at ${args.superseded.localTip.slice(0, 12)} holds nothing the origin does not — the host changes are superseded by origin/${args.superseded.branch}.`,
    `To discard the host state, including the uncommitted changes this descend just landed: git reset --hard origin/${args.superseded.branch}. That call is the operator’s, not this session’s.`,
  ].join(' '),
})
