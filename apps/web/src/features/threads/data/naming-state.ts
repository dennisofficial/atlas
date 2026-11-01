import { displayedThreadTitle } from '@dltech/atlas-core'
import { EPodState, type PodStatus } from '@dltech/atlas-wire/web'

export type NamingState = { title: string | null; naming: boolean }

export const isPodStarting = (pod: PodStatus | null): boolean =>
  pod === null || pod.state === EPodState.Booting

export function namingStateOf(args: {
  storedTitle: string | null
  liveTitle: string | null
  titling: boolean
  pod: PodStatus | null
}): NamingState {
  const raw = args.liveTitle ?? args.storedTitle
  const title = raw === null ? null : displayedThreadTitle(raw)
  return { title, naming: title === null && (args.titling || isPodStarting(args.pod)) }
}
