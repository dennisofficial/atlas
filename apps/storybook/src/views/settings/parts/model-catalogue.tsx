import { useState } from 'react'

import type { EModelFilter } from '@dltech/atlas-ui/ai/model-selector'
import { Button } from '@dltech/atlas-ui/components/button'

import type { ModelsConfig, ProviderAccessMap } from '@dltech/atlas-ui/fixtures/settings-models'
import { SettingsCard, SettingsSection } from '../settings-layout'
import { CatalogueRow } from './model-catalogue-row'
import {
  ECatalogueRoute,
  PAGE_SIZE,
  buildEntries,
  filterEntries,
  summarize,
  visibleCount,
  type RouteFilter,
} from './model-catalogue-state'
import { CatalogueToolbar } from './model-catalogue-toolbar'

export function ModelCatalogue({
  config,
  access,
  pinned,
  onPinnedChange,
  initialQuery = '',
  onOpenProviders,
}: {
  config: ModelsConfig
  access: ProviderAccessMap
  pinned: string[]
  onPinnedChange: (next: string[]) => void
  initialQuery?: string
  onOpenProviders: () => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [route, setRoute] = useState<RouteFilter>(ECatalogueRoute.Connected)
  const [capabilities, setCapabilities] = useState<EModelFilter[]>([])
  const [pages, setPages] = useState(1)

  const all = buildEntries({ access, config })
  const summary = summarize(all)
  const matches = filterEntries({ entries: all, query, route, capabilities, pinned })
  const shown = matches.slice(0, visibleCount({ entries: matches, pinned, pages }))
  const remaining = matches.length - shown.length

  const handleQueryChange = (next: string) => {
    setQuery(next)
    setPages(1)
  }
  const handleRouteChange = (next: RouteFilter) => {
    setRoute(next)
    setPages(1)
  }
  const handleCapabilityToggle = (capability: EModelFilter) => {
    setCapabilities(
      capabilities.includes(capability)
        ? capabilities.filter((active) => active !== capability)
        : [...capabilities, capability],
    )
    setPages(1)
  }
  const handleTogglePin = (key: string) =>
    onPinnedChange(pinned.includes(key) ? pinned.filter((id) => id !== key) : [...pinned, key])
  const handleShowMore = () => setPages(pages + 1)

  return (
    <SettingsSection
      title="Models"
      description={`${summary.total} models · ${summary.viaSubscription} available via your subscriptions`}
    >
      <CatalogueToolbar
        query={query}
        route={route}
        capabilities={capabilities}
        access={access}
        onQueryChange={handleQueryChange}
        onRouteChange={handleRouteChange}
        onCapabilityToggle={handleCapabilityToggle}
      />
      <SettingsCard>
        {shown.length === 0 ? (
          <p role="status" className="px-4 py-8 text-center text-sm text-muted-foreground">
            No models match these filters.
          </p>
        ) : (
          <ul className="divide-y">
            {shown.map((entry) => (
              <CatalogueRow
                key={entry.model.key}
                entry={entry}
                pinned={pinned.includes(entry.model.key)}
                onTogglePin={handleTogglePin}
                onOpenProviders={onOpenProviders}
              />
            ))}
          </ul>
        )}
        {remaining > 0 ? (
          <div className="flex items-center justify-between gap-3 bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
            <span>
              Showing {shown.length} of {matches.length}
            </span>
            <Button variant="outline" size="xs" onClick={handleShowMore}>
              Show {Math.min(PAGE_SIZE, remaining)} more
            </Button>
          </div>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  )
}
