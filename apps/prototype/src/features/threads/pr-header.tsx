import { ChevronDownIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@dltech/atlas-ui/components/popover'
import { Switch } from '@dltech/atlas-ui/components/switch'

import { PrBell, PrChip, PrRow } from './pr-parts'
import {
  EPrDesign,
  othersOf,
  pinnedOf,
  toggleWatched,
  type PullRequest,
  type PullRequestsConfig,
} from './pull-request-model'

interface VariantProps {
  prs: PullRequest[]
  onToggle: (number: number) => void
}

function PinnedWithList({ prs, onToggle }: VariantProps) {
  const pinned = pinnedOf(prs)
  const others = othersOf(prs)
  if (!pinned) return null
  return (
    <div className="flex items-center gap-1">
      <PrChip pr={pinned} />
      {others.length > 0 ? (
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                size="xs"
                aria-label={`${others.length} more pull requests`}
              />
            }
          >
            <span className="tabular-nums">+{others.length}</span>
            <ChevronDownIcon />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 gap-1 p-1.5">
            <p className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
              Pull requests
            </p>
            {prs.map((pr) => (
              <PrRow
                key={pr.number}
                pr={pr}
                control={<PrBell pr={pr} size="icon-xs" onToggle={() => onToggle(pr.number)} />}
              />
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
      <PrBell pr={pinned} onToggle={() => onToggle(pinned.number)} />
    </div>
  )
}

function InlineSplit({ prs, onToggle }: VariantProps) {
  return (
    <div className="flex items-center gap-1.5">
      {prs.map((pr) => (
        <div
          key={pr.number}
          className="inline-flex items-center overflow-hidden rounded-4xl border border-border"
        >
          <PrChip pr={pr} className="rounded-r-none border-0" />
          <PrBell
            pr={pr}
            size="icon-xs"
            className="rounded-l-none border-l border-border"
            onToggle={() => onToggle(pr.number)}
          />
        </div>
      ))}
    </div>
  )
}

function ResponsiveInline(props: VariantProps) {
  return (
    <>
      <div className="hidden xl:block">
        <InlineSplit {...props} />
      </div>
      <div className="xl:hidden">
        <PinnedWithList {...props} />
      </div>
    </>
  )
}

function PinnedOnly({ prs, onToggle }: VariantProps) {
  const pinned = pinnedOf(prs)
  if (!pinned) return null
  return (
    <div className="flex items-center gap-1">
      <PrChip pr={pinned} />
      <PrBell pr={pinned} onToggle={() => onToggle(pinned.number)} />
    </div>
  )
}

export function PrPanel({ prs, onToggle }: VariantProps) {
  return (
    <section
      aria-label="Pull requests"
      className="flex shrink-0 flex-col gap-0.5 border-b border-border bg-card px-3 py-2"
    >
      <h2 className="px-2 pb-0.5 text-xs font-medium text-muted-foreground">Pull requests</h2>
      {prs.map((pr) => (
        <PrRow
          key={pr.number}
          pr={pr}
          control={
            <Switch
              size="sm"
              checked={pr.watched}
              aria-label={`Watch #${pr.number}`}
              onCheckedChange={() => onToggle(pr.number)}
            />
          }
        />
      ))}
    </section>
  )
}

export function usePullRequests(config: PullRequestsConfig) {
  const [prs, setPrs] = useState(config.prs)
  const handleToggle = (number: number) =>
    setPrs((current) => toggleWatched({ prs: current, number }))
  return { prs, design: config.design, onToggle: handleToggle }
}

export function PrHeaderSlot({ design, prs, onToggle }: VariantProps & { design: EPrDesign }) {
  if (design === EPrDesign.InlineSplit) return <ResponsiveInline prs={prs} onToggle={onToggle} />
  if (design === EPrDesign.Panel) return <PinnedOnly prs={prs} onToggle={onToggle} />
  return <PinnedWithList prs={prs} onToggle={onToggle} />
}
