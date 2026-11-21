import {
  EIndexPressure,
  MEMORY_INDEX_ADVISORY_CHARS,
  MEMORY_INDEX_DESCRIPTION_CHARS,
  MEMORY_INDEX_RECONCILE_CHARS,
} from './index-pressure'

export type ReconcileEntry = {
  scope: string
  name: string
  updatedAt: string
  descriptionChars: number
}

const openingOf = (args: { pressure: EIndexPressure; indexChars: number }): string => {
  const size = `The memory index is now ${args.indexChars} characters. Every model request of every session carries it.`
  if (args.pressure === EIndexPressure.Reconcile) {
    return `${size} This is more than the reconcile limit of ${MEMORY_INDEX_RECONCILE_CHARS} characters. Reconcile the memory now, before you continue the task.`
  }
  return `${size} This is more than the advisory limit of ${MEMORY_INDEX_ADVISORY_CHARS} characters. Reconcile the memory when the current task lets you, in this session.`
}

const STEPS: readonly string[] = [
  'Reconcile on your own:',
  '1. Merge memories that make the same claim. Write one memory, then delete the others.',
  `2. Rewrite each description that is longer than ${MEMORY_INDEX_DESCRIPTION_CHARS} characters. Keep one claim in the description. Move the reason and the details into the body.`,
  '3. Delete memories that are no longer true.',
  'Start with the oldest memories. Read a memory before you change it. Ask the operator only when you are not sure that a memory is still true.',
  `The goal is an index of less than ${MEMORY_INDEX_ADVISORY_CHARS} characters.`,
]

const byOldest = (left: ReconcileEntry, right: ReconcileEntry): number =>
  left.updatedAt < right.updatedAt ? -1 : left.updatedAt > right.updatedAt ? 1 : 0

const entryLineOf = (entry: ReconcileEntry): string => {
  const long =
    entry.descriptionChars > MEMORY_INDEX_DESCRIPTION_CHARS
      ? ` (description ${entry.descriptionChars} characters)`
      : ''
  return `- ${entry.updatedAt.slice(0, 10)} ${entry.scope} ${entry.name}${long}`
}

export const reconcileNoticeOf = (args: {
  pressure: EIndexPressure
  indexChars: number
  entries: readonly ReconcileEntry[]
}): string =>
  [
    openingOf(args),
    '',
    ...STEPS,
    '',
    'Memories by last update, oldest first:',
    ...[...args.entries].sort(byOldest).map(entryLineOf),
  ].join('\n')
