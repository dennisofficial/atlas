import { SearchIcon } from 'lucide-react'

import {
  EModelFilter,
  MODEL_FILTER_LABELS,
  MODEL_FILTER_ORDER,
} from '@dltech/atlas-ui/ai/model-selector'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@dltech/atlas-ui/components/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dltech/atlas-ui/components/select'
import { Toggle } from '@dltech/atlas-ui/components/toggle'

import { EProviderId } from '@dltech/atlas-ui/fixtures/settings-agent'
import { PROVIDER_LABELS, type ProviderAccessMap } from '@dltech/atlas-ui/fixtures/settings-models'
import { ECatalogueRoute, type RouteFilter } from './model-catalogue-state'
import { PROVIDER_PRECEDENCE, routeFor, EReach } from './model-routes'

type RouteItem = { value: RouteFilter; label: string }

function routeItems(access: ProviderAccessMap): RouteItem[] {
  const providers: RouteItem[] = PROVIDER_PRECEDENCE.filter(
    (provider) => routeFor({ provider, access }).reach !== EReach.Missing,
  ).map((provider) => ({
    value: provider,
    label: routeFor({ provider, access }).label || PROVIDER_LABELS[provider],
  }))
  return [
    { value: ECatalogueRoute.Connected, label: 'All connected' },
    ...providers,
    { value: ECatalogueRoute.Unconnected, label: 'Not connected' },
  ]
}

function isRouteFilter(value: unknown): value is RouteFilter {
  return (
    value === ECatalogueRoute.Connected ||
    value === ECatalogueRoute.Unconnected ||
    Object.values(EProviderId).some((provider) => provider === value)
  )
}

export function CatalogueToolbar({
  query,
  route,
  capabilities,
  access,
  onQueryChange,
  onRouteChange,
  onCapabilityToggle,
}: {
  query: string
  route: RouteFilter
  capabilities: EModelFilter[]
  access: ProviderAccessMap
  onQueryChange: (query: string) => void
  onRouteChange: (route: RouteFilter) => void
  onCapabilityToggle: (capability: EModelFilter) => void
}) {
  const items = routeItems(access)

  const handleQueryChange = (event: { target: { value: string } }) =>
    onQueryChange(event.target.value)
  const handleRouteChange = (next: unknown) => {
    if (isRouteFilter(next)) onRouteChange(next)
  }
  const selected = items.find((item) => item.value === route)?.value ?? ECatalogueRoute.Connected

  return (
    <div className="flex flex-wrap items-center gap-2">
      <InputGroup className="min-w-48 flex-1 basis-56">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search models"
          placeholder="Search models"
          value={query}
          onChange={handleQueryChange}
        />
      </InputGroup>
      <Select<RouteFilter> items={items} value={selected} onValueChange={handleRouteChange}>
        <SelectTrigger size="sm" className="w-44" aria-label="Route">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end" alignItemWithTrigger={false}>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <fieldset aria-label="Capabilities" className="m-0 flex min-w-0 gap-1 border-0 p-0">
        {MODEL_FILTER_ORDER.map((capability) => (
          <Toggle
            key={capability}
            size="sm"
            variant="outline"
            pressed={capabilities.includes(capability)}
            onPressedChange={() => onCapabilityToggle(capability)}
          >
            {MODEL_FILTER_LABELS[capability]}
          </Toggle>
        ))}
      </fieldset>
    </div>
  )
}
