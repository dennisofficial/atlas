import type { SessionStatusOutput } from '@dltech/atlas-protocol'

import { chipItem, EFooterItemReach, type FooterItem } from '../ui/footer-item'
import { theme } from '../ui/theme'

type PodState = SessionStatusOutput['pod']

const groundOf = (phase: string): string => {
  if (phase === 'failed') return theme.error
  if (phase === 'resizing' || phase === 'waiting') return theme.warn
  return theme.link
}

const vcpusOf = (pod: NonNullable<PodState>): number | undefined =>
  pod.actualVcpus ?? pod.desiredVcpus ?? pod.shape?.vcpus ?? pod.desiredShape?.vcpus

export const podPillOf = (args: {
  pod: PodState
  sandbox: SessionStatusOutput['sandbox']
  now: number
}): FooterItem | null => {
  const pod = args.pod
  if (pod === undefined) return null

  const vcpus = vcpusOf(pod)
  return chipItem({
    id: 'pod',
    text: vcpus === undefined ? ' pod ' : ` ${vcpus} vCPU `,
    ground: groundOf(pod.phase),
    reach: EFooterItemReach.None,
  })
}
