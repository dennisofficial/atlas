import Link from 'next/link'
import { BrainIcon, CheckIcon, ImageIcon, StarIcon } from 'lucide-react'

import { Badge } from '@dltech/atlas-ui/components/badge'
import { BrandMark } from '@dltech/atlas-ui/components/brand-mark'
import { Button } from '@dltech/atlas-ui/components/button'

import { ROLE_META } from '@dltech/atlas-ui/fixtures/settings-models'
import {
  contextLabel,
  familyMark,
  priceLabel,
} from '@dltech/atlas-ui/fixtures/settings-models-catalogue'
import { cn } from '@dltech/atlas-ui/lib/utils'
import { ESettingsPage, hrefOfPage } from '../settings-nav'
import { MonogramTile } from '../settings-layout'
import type { CatalogueEntry } from './model-catalogue-state'
import { EReach, ERouteKind } from './model-routes'

export const CATALOGUE_GRID =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,15rem)_2rem] items-center gap-4 px-4'

function FamilyMark({ vendor }: { vendor: string }) {
  const mark = familyMark(vendor)
  if (mark.brand) return <BrandMark brand={mark.brand} className="size-7" />
  return <MonogramTile label={vendor} className="size-7" />
}

function RouteChips({ entry }: { entry: CatalogueEntry }) {
  if (entry.vias.length === 0) {
    return (
      <Button
        variant="link"
        size="xs"
        className="h-auto justify-self-start p-0"
        nativeButton={false}
        render={<Link href={hrefOfPage(ESettingsPage.Providers)} />}
      >
        Connect a provider
      </Button>
    )
  }
  return (
    <div className="flex flex-wrap gap-1">
      {entry.vias.map((via, index) => {
        const served = via === entry.used
        const expired = via.reach === EReach.Expired
        return (
          <Badge
            key={`${via.provider}-${via.kind}`}
            variant={served ? 'secondary' : 'outline'}
            title={served ? `Served by ${via.label}` : via.label}
            className={cn(
              expired && 'text-warning',
              index > 0 && !served && 'text-muted-foreground',
            )}
          >
            {served ? <CheckIcon aria-hidden /> : null}
            {served ? <span className="sr-only">Served by </span> : null}
            {via.label}
            {expired ? <span className="sr-only"> (sign-in expired)</span> : null}
          </Badge>
        )
      })}
    </div>
  )
}

export function CatalogueRow({
  entry,
  pinned,
  onTogglePin,
}: {
  entry: CatalogueEntry
  pinned: boolean
  onTogglePin: (key: string) => void
}) {
  const { model, row, used, users } = entry
  const price = used?.kind === ERouteKind.Key ? priceLabel(used.row.cost) : undefined
  const facts = [
    `${contextLabel(row.contextWindow)} context`,
    price,
    users.length > 0
      ? `Used by ${users.map((role) => ROLE_META[role].title).join(', ')}`
      : undefined,
  ].filter(Boolean)

  const handlePinClick = () => onTogglePin(model.key)

  return (
    <li className={`${CATALOGUE_GRID} py-2.5`}>
      <div className="flex min-w-0 items-center gap-3">
        <FamilyMark vendor={model.vendor} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{model.label}</span>
            {row.images ? (
              <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Images" />
            ) : null}
            {row.efforts.length > 0 ? (
              <BrainIcon
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label="Reasoning"
              />
            ) : null}
          </div>
          <span className="truncate text-xs text-muted-foreground tabular-nums">
            {facts.join(' · ')}
          </span>
        </div>
      </div>
      <RouteChips entry={entry} />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={pinned ? `Unpin ${model.label}` : `Pin ${model.label}`}
        aria-pressed={pinned}
        onClick={handlePinClick}
      >
        <StarIcon className={cn(pinned && 'fill-current text-foreground')} />
      </Button>
    </li>
  )
}
