import type { LinkedPullRequest } from '@dltech/atlas-core'
import {
  EPullRequestLookup,
  probeCheckout,
  type PullRequestPort,
  type RepositoryCheckout,
} from '@dltech/atlas-harness'

import type { ThreadChip, ThreadRow } from '../ui/threads-model'
import { chipFromReading, MUTED_CHIP, sameChips, type CheckoutProbe } from './thread-chip-model'

export type ThreadChipsHandle = {
  sync: (args: { rows: readonly ThreadRow[] }) => Map<string, readonly ThreadChip[]>
  stop: () => void
}

const identityOf = (checkout: RepositoryCheckout, number: number): string =>
  `${checkout.remote.host}/${checkout.remote.owner}/${checkout.remote.repo}#${number}`

export function openThreadChips(args: {
  home: string
  pullRequests: PullRequestPort
  onLanded: (chips: Map<string, readonly ThreadChip[]>) => void
  probe?: CheckoutProbe
}): ThreadChipsHandle {
  const askGit = args.probe ?? probeCheckout
  const directoryOf = (row: ThreadRow): string => row.worktree?.path ?? args.home

  const checkouts = new Map<string, RepositoryCheckout | null>()
  const probing = new Set<string>()
  const chips = new Map<string, readonly ThreadChip[]>()
  const lastRows = new Map<string, ThreadRow>()
  const touched = new Set<string>()
  let stopped = false
  let emitting = false

  const collect = (): Map<string, readonly ThreadChip[]> => {
    const ready = new Map<string, readonly ThreadChip[]>()
    for (const threadId of touched) {
      const held = chips.get(threadId)
      if (held !== undefined) ready.set(threadId, held)
      touched.delete(threadId)
    }
    return ready
  }

  const emit = (): void => {
    if (stopped || emitting) return
    emitting = true
    queueMicrotask(() => {
      emitting = false
      if (stopped) return

      const ready = collect()
      if (ready.size > 0) args.onLanded(ready)
    })
  }

  const checkoutChip = (checkout: RepositoryCheckout): ThreadChip | null => {
    const reading = args.pullRequests.peekBadge({ kind: 'checkout', checkout })
    if (reading === null || reading.lookup !== EPullRequestLookup.Found) return null

    return chipFromReading({ label: `#${reading.pullRequest.number}`, reading })
  }

  const linkedChip = (link: LinkedPullRequest): ThreadChip => {
    const reading = args.pullRequests.peekBadge({
      kind: 'linked',
      repo: link.repo,
      number: link.number,
    })
    if (reading === null) return { label: `#${link.number}`, ...MUTED_CHIP }

    return chipFromReading({ label: `#${link.number}`, reading })
  }

  const chipsOf = (row: ThreadRow): readonly ThreadChip[] => {
    const links = row.pullRequests ?? []
    const drawn: ThreadChip[] = []
    const identities = new Set<string>()
    for (const link of links) {
      identities.add(`${link.repo}#${link.number}`)
      drawn.push(linkedChip(link))
    }

    const checkout = checkouts.get(directoryOf(row))
    if (checkout !== null && checkout !== undefined) {
      const chip = checkoutChip(checkout)
      if (chip !== null) {
        const reading = args.pullRequests.peekBadge({ kind: 'checkout', checkout })
        const number = reading?.lookup === EPullRequestLookup.Found ? reading.pullRequest.number : null
        if (number === null || !identities.has(identityOf(checkout, number))) drawn.push(chip)
      }
    }

    return drawn
  }

  const freshenRow = (row: ThreadRow): void => {
    for (const link of row.pullRequests ?? []) {
      args.pullRequests.freshenBadge({ kind: 'linked', repo: link.repo, number: link.number })
    }

    const checkout = checkouts.get(directoryOf(row))
    if (checkout !== null && checkout !== undefined) {
      args.pullRequests.freshenBadge({ kind: 'checkout', checkout })
    }
  }

  const repaint = (row: ThreadRow): void => {
    const next = chipsOf(row)
    const previous = chips.get(row.threadId)
    if (previous !== undefined && sameChips(previous, next)) return

    chips.set(row.threadId, next)
    touched.add(row.threadId)
    emit()
  }

  const probeRow = (row: ThreadRow): void => {
    const directory = directoryOf(row)
    if (checkouts.has(directory) || probing.has(directory)) return

    probing.add(directory)
    void askGit({ directory })
      .catch(() => null)
      .then((checkout) => {
        probing.delete(directory)
        checkouts.set(directory, checkout)
        if (stopped) return

        for (const sharing of lastRows.values()) {
          if (directoryOf(sharing) !== directory) continue
          if (checkout !== null) freshenRow(sharing)
          repaint(sharing)
        }
        emit()
      })
  }

  const unsubscribe = args.pullRequests.onBadges(() => {
    if (stopped) return
    for (const row of lastRows.values()) repaint(row)
    emit()
  })

  return {
    sync: ({ rows }) => {
      for (const row of rows) {
        lastRows.set(row.threadId, row)
        probeRow(row)
        freshenRow(row)
        repaint(row)
      }
      return collect()
    },
    stop: () => {
      stopped = true
      unsubscribe()
      touched.clear()
    },
  }
}
