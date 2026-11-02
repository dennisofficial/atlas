import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { EPodState, PodStatusChip } from '@dltech/atlas-ui/ai/pod-status-chip'

import { simulateResize } from '../pod-status'
import { DENSE_HEAD, DENSE_POD } from './dense-fixtures'

const POD = {
  state: EPodState.Running,
  vcpus: DENSE_POD.vcpus,
  podId: 'pod_8f3k2a91',
  region: DENSE_POD.region,
}

function Stat(props: { value: ReactNode; unit: string }) {
  return (
    <span className="flex h-4 items-center gap-1 whitespace-nowrap">
      <span className="text-foreground tabular-nums">{props.value}</span>
      <span>{props.unit}</span>
    </span>
  )
}

function Tokens() {
  return (
    <span className="flex h-4 items-center gap-1.5 whitespace-nowrap tabular-nums">
      <span className="flex items-center gap-0.5">
        <ArrowUpIcon role="img" aria-label="Input tokens" className="size-3" />
        <span className="text-foreground">{DENSE_HEAD.tokensIn}</span>
      </span>
      <span className="flex items-center gap-0.5">
        <ArrowDownIcon role="img" aria-label="Output tokens" className="size-3" />
        <span className="text-foreground">{DENSE_HEAD.tokensOut}</span>
      </span>
    </span>
  )
}

export function HeadSection() {
  return (
    <header className="flex flex-col gap-2 px-1">
      <div className="flex items-start justify-between gap-3">
        <h2 className="line-clamp-2 min-w-0 pt-0.5 text-sm font-medium">{DENSE_HEAD.title}</h2>
        <PodStatusChip status={POD} onResize={simulateResize} settingsHref="#" />
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4 text-muted-foreground">
        <Stat value={DENSE_HEAD.turns} unit="turns" />
        <Stat value={DENSE_HEAD.cost} unit="spent" />
        <Tokens />
        <Stat value={DENSE_HEAD.cache} unit="cached" />
      </p>
    </header>
  )
}
