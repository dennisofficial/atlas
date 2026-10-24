import {
  bootAttemptsOf,
  EPodState,
  type PodStatus,
  type RecordedBootStep,
} from '@dltech/atlas-wire/web'

import { bootViewOf, settledBootViewOf, type BootView } from './boot-view'
import { ETurnKind, type Turn } from './transcript-turns'

const CLOCK_SKEW_MS = 2_000

export enum EBootEntryKind {
  Boot = 'boot',
  Parked = 'parked',
}

export type BootEntry =
  | {
      kind: EBootEntryKind.Boot
      id: string
      afterIndex: number
      view: BootView
      live: boolean
    }
  | { kind: EBootEntryKind.Parked; id: string; afterIndex: number }

const startOf = (attempt: readonly RecordedBootStep[]): number =>
  Date.parse(attempt[0]?.at ?? '') || 0

const firstUserOf = (turns: readonly Turn[]): number =>
  turns.findIndex((turn) => turn.kind === ETurnKind.User)

function anchorOf(args: { turns: readonly Turn[]; startMs: number }): number {
  const { turns, startMs } = args
  const woken = turns.findLastIndex(
    (turn) =>
      turn.kind === ETurnKind.User &&
      turn.item.at !== undefined &&
      Date.parse(turn.item.at) <= startMs + CLOCK_SKEW_MS,
  )
  return woken !== -1 ? woken : firstUserOf(turns)
}

function latestPerAnchor(args: {
  turns: readonly Turn[]
  attempts: readonly RecordedBootStep[][]
}): { afterIndex: number; attempt: RecordedBootStep[] }[] {
  const placed: { afterIndex: number; attempt: RecordedBootStep[] }[] = []
  for (const attempt of args.attempts) {
    const afterIndex = anchorOf({
      turns: args.turns,
      startMs: startOf(attempt),
    })
    const previous = placed.at(-1)
    if (previous !== undefined && previous.afterIndex >= afterIndex) {
      placed[placed.length - 1] = { afterIndex: previous.afterIndex, attempt }
    } else {
      placed.push({ afterIndex, attempt })
    }
  }
  return placed
}

export function bootTimelineOf(args: {
  turns: readonly Turn[]
  pod: PodStatus | null
  now: number
}): BootEntry[] {
  const { turns, pod } = args
  if (pod === null || pod.state === EPodState.None) return []
  const attempts = bootAttemptsOf(pod.history ?? pod.steps)
  const placed = latestPerAnchor({ turns, attempts })
  const current = bootViewOf({ pod, now: args.now })
  const entries: BootEntry[] = placed.map(({ afterIndex, attempt }, index) => {
    const live = index === placed.length - 1 && current !== null
    return {
      kind: EBootEntryKind.Boot,
      id: `sandbox-boot-${startOf(attempt)}`,
      afterIndex,
      view: live ? current : settledBootViewOf(attempt),
      live,
    }
  })
  if (entries.length === 0 && current !== null) {
    entries.push({
      kind: EBootEntryKind.Boot,
      id: 'sandbox-boot',
      afterIndex: firstUserOf(turns),
      view: current,
      live: true,
    })
  }
  if (pod.state === EPodState.Parked) {
    entries.push({
      kind: EBootEntryKind.Parked,
      id: 'sandbox-parked',
      afterIndex: turns.length - 1,
    })
  }
  return entries
}
