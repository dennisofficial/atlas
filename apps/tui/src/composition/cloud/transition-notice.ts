import type { EventDraft } from '@dltech/atlas-core'

import type { LiftedWorkspace } from './cloud-bridge'
import type { RemoteMemoryConflict } from './merge-remote-memory'

export const CLOUD_NOTICE_SLOT = 'session'

export const CLOUD_NOTICE_KEY = 'execution-location'

export type StoppedLocally = {
  shells: readonly string[]
  services: readonly string[]
}

export const NOTHING_WAS_STOPPED: StoppedLocally = Object.freeze({
  shells: Object.freeze([]),
  services: Object.freeze([]),
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

  return `The workspace was rebuilt here${from}${on} at ${at}, and the uncommitted work — tracked edits and untracked files alike — came along as a scratch baseline commit, so the tree here reads clean while the operator's branch back home is untouched.`
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

const CONFLICT_TEXT_BUDGET = 2_000

const conflictBlock = (conflict: RemoteMemoryConflict): string => {
  const text =
    conflict.text.length <= CONFLICT_TEXT_BUDGET
      ? conflict.text
      : `${conflict.text.slice(0, CONFLICT_TEXT_BUDGET)}…`
  return `--- ${conflict.key} ---\n${text}`
}

/**
 * The memory side of the mirror image: the cloud wrote notes this machine had newer copies of, so
 * the local copies won the merge — and the cloud's versions are kept verbatim in the log rather
 * than dropped, which is the whole reason this is prose and not a silent skip.
 */
export const descendedMemoryConflictsDraft = (args: {
  conflicts: readonly RemoteMemoryConflict[]
}): EventDraft => ({
  type: 'context-loaded',
  slot: CLOUD_NOTICE_SLOT,
  key: CLOUD_NOTICE_KEY,
  content: [
    'This session has moved: it now runs on the operator’s machine again. The cloud had written memory this machine held newer copies of, so the local versions won the merge — and the cloud versions are kept here, verbatim, so nothing it learned is lost:',
    ...args.conflicts.map(conflictBlock),
  ].join('\n\n'),
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
