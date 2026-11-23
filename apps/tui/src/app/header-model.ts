import type { SessionChangesOutput } from '@dltech/atlas-protocol'

import type { ChangesState } from './use-changes'

export type DiffStat = { added: number; removed: number }

const EMPTY: DiffStat = { added: 0, removed: 0 }

export const diffStatOf = (checkouts: SessionChangesOutput['checkouts']): DiffStat | null => {
  const [first] = checkouts
  if (first === undefined || first.files.length === 0) return null

  return first.files.reduce<DiffStat>(
    (total, file) => ({
      added: total.added + file.additions,
      removed: total.removed + file.deletions,
    }),
    EMPTY,
  )
}

const shortNameOf = (repo: string): string => repo.split('/').filter(Boolean).at(-1) ?? repo

export const headerModelOf = (args: {
  repo: string | null
  changes: ChangesState
  width: number
}): { repo: string; diff: DiffStat | null } => {
  const { repo, changes } = args
  if (repo === null) return { repo: '', diff: null }

  if (changes.status !== 'ready') return { repo: shortNameOf(repo), diff: null }

  const matched = changes.checkouts.find((checkout) => checkout.repo === repo)
  return {
    repo: shortNameOf(repo),
    diff: matched === undefined ? null : diffStatOf([matched]),
  }
}
