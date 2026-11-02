import { EWaitEpisodeKind, type AvailabilityKey, type WaitingForModel } from '@dltech/atlas-core'

import { isManualPause } from './model-wait'

export enum EAccountAccess {
  Available = 'available',
  Paused = 'paused',
  Exhausted = 'exhausted',
  Unavailable = 'unavailable',
}

export type AccountAccess = {
  access: EAccountAccess
  label: string | null
  key: AvailabilityKey | null
  generation: number | null
  affected: number
}

const LABELS: Readonly<Record<EAccountAccess, string | null>> = {
  [EAccountAccess.Available]: null,
  [EAccountAccess.Paused]: 'Paused by you',
  [EAccountAccess.Exhausted]: 'Allowance exhausted',
  [EAccountAccess.Unavailable]: 'Model access unavailable',
}

const accessOf = (waiting: WaitingForModel): EAccountAccess => {
  if (isManualPause(waiting)) return EAccountAccess.Paused
  return waiting.reason === 'quota' ? EAccountAccess.Exhausted : EAccountAccess.Unavailable
}

export function accountAccessOf(args: {
  accountId: string
  waiting: readonly WaitingForModel[]
  manuallyPaused?: boolean | undefined
}): AccountAccess {
  const own = args.waiting.filter(
    (entry) =>
      entry.episode.kind === EWaitEpisodeKind.Credential &&
      entry.episode.key.accountId === args.accountId,
  )
  const affected = new Set(own.flatMap((entry) => entry.affectedThreadIds)).size
  const lead = own.find(isManualPause) ?? own[0]
  const episode = lead?.episode
  const key = episode?.kind === EWaitEpisodeKind.Credential ? episode.key : null
  const generation = episode?.kind === EWaitEpisodeKind.Credential ? episode.generation : null
  const access =
    lead !== undefined
      ? accessOf(lead)
      : args.manuallyPaused === true
        ? EAccountAccess.Paused
        : EAccountAccess.Available
  return { access, label: LABELS[access], key, generation, affected }
}

export const pauseConfirmationOf = (args: { accountLabel: string; affected: number }) => ({
  title: `Pause ${args.accountLabel}?`,
  description: `New model requests on ${args.accountLabel} stop. ${
    args.affected === 0
      ? 'No sessions currently waiting.'
      : `${args.affected} ${args.affected === 1 ? 'session is' : 'sessions are'} using it.`
  } Work already in flight finishes.`,
  confirmLabel: 'Pause account',
})
