'use client'

import { useState, type RefObject } from 'react'
import { Settings2Icon } from 'lucide-react'

import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '#components/command'

import {
  EModelSelectorState,
  EProviderGroupKind,
  FOLLOW_VALUE,
  MANAGE_PROVIDERS_VALUE,
  availableFilters,
  firstItemValue,
  modelSelectorGroups,
  type EModelFilter,
  type ModelOption,
  type ModelSelectorGroups,
} from '../model-selector-groups'
import {
  FilterChips,
  FollowRow,
  ModelRow,
  NoProvidersState,
  ReconnectRow,
  ShowAllRow,
} from './model-selector-rows'

export interface ModelListProps {
  models: ModelOption[]
  value: string
  pinned: readonly string[]
  canPin: boolean
  showRate: boolean
  canManageProviders: boolean
  onManageProviders: () => void
  reconnectProviders: readonly string[]
  reconnectNotes: Record<string, string>
  onReconnect: (provider: string) => void
  collapsedProviders: readonly string[]
  collapsedLimit: number
  follow?: { label: string; active: boolean; onFollow: () => void }
  onSelect: (id: string) => void
  onPinToggle: (id: string) => void
  onClose: () => void
  inputRef: RefObject<HTMLInputElement | null>
}

export function ModelList({
  models,
  value,
  pinned,
  canPin,
  showRate,
  canManageProviders,
  onManageProviders,
  reconnectProviders,
  reconnectNotes,
  onReconnect,
  collapsedProviders,
  collapsedLimit,
  follow,
  onSelect,
  onPinToggle,
  onClose,
  inputRef,
}: ModelListProps) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<EModelFilter[]>([])
  const [expanded, setExpanded] = useState<string[]>([])

  const groupsFor = ({
    nextQuery,
    nextFilters,
  }: {
    nextQuery: string
    nextFilters: EModelFilter[]
  }): ModelSelectorGroups =>
    modelSelectorGroups({
      models,
      query: nextQuery,
      pinned,
      reconnectProviders,
      canManageProviders,
      filters: nextFilters,
      collapsedProviders,
      collapsedLimit,
      expandedProviders: expanded,
    })
  const groups = groupsFor({ nextQuery: query, nextFilters: filters })
  const filterOptions = availableFilters(models)
  const pinnedIds = new Set(groups.pinned.map((model) => model.id))
  const routedProviders = new Set(models.flatMap((model) => (model.route ? [model.provider] : [])))
  const following = follow?.active === true
  const firstValue = (next: ModelSelectorGroups): string | undefined =>
    follow === undefined ? firstItemValue(next) : FOLLOW_VALUE
  const [highlighted, setHighlighted] = useState(() => firstValue(groups) ?? '')

  if (groups.state === EModelSelectorState.NoProviders) {
    return <NoProvidersState canConnect={canManageProviders} onConnect={onManageProviders} />
  }

  const handleQueryChange = (next: string) => {
    setQuery(next)
    setHighlighted(firstValue(groupsFor({ nextQuery: next, nextFilters: filters })) ?? '')
  }
  const handleFilterToggle = (filter: EModelFilter) => {
    const next = filters.includes(filter)
      ? filters.filter((active) => active !== filter)
      : [...filters, filter]
    setFilters(next)
    setHighlighted(firstValue(groupsFor({ nextQuery: query, nextFilters: next })) ?? '')
  }
  const handleTogglePin = (id: string) => onPinToggle(id)
  const handleFollow = () => {
    follow?.onFollow()
    onClose()
  }
  const handleManageProviders = () => {
    onManageProviders()
    onClose()
  }
  const handleReconnect = (provider: string) => {
    onReconnect(provider)
    onClose()
  }

  const renderRow = (model: ModelOption, showRoute: boolean) => (
    <ModelRow
      key={model.id}
      model={model}
      checked={!following && model.id === value}
      pinned={pinnedIds.has(model.id)}
      canPin={canPin}
      showRate={showRate}
      showRoute={showRoute}
      onSelect={onSelect}
      onTogglePin={handleTogglePin}
    />
  )

  return (
    <Command
      label="Models"
      shouldFilter={false}
      loop
      value={highlighted}
      onValueChange={setHighlighted}
    >
      <CommandInput
        ref={inputRef}
        autoFocus
        aria-label="Search models"
        placeholder="Search models"
        value={query}
        onValueChange={handleQueryChange}
      />
      {filterOptions.length > 0 ? (
        <FilterChips filters={filterOptions} active={filters} onToggle={handleFilterToggle} />
      ) : null}
      <CommandList className="max-h-96">
        {groups.state === EModelSelectorState.NoMatches ? (
          <p role="status" className="px-2 py-6 text-center text-sm text-muted-foreground">
            No models match
            {query.trim() ? ` “${query.trim()}”` : ' these filters'}
          </p>
        ) : null}
        {follow === undefined ? null : (
          <CommandGroup>
            <FollowRow label={follow.label} checked={follow.active} onSelect={handleFollow} />
          </CommandGroup>
        )}
        {groups.pinned.length > 0 ? (
          <CommandGroup heading="Pinned">
            {groups.pinned.map((model) => renderRow(model, routedProviders.size > 0))}
          </CommandGroup>
        ) : null}
        {groups.providers.map((group) => (
          <CommandGroup key={group.provider} heading={group.provider}>
            {group.kind === EProviderGroupKind.Reconnect ? (
              <ReconnectRow
                provider={group.provider}
                note={reconnectNotes[group.provider]}
                onReconnect={handleReconnect}
              />
            ) : (
              <>
                {group.models.map((model) => renderRow(model, false))}
                {group.hidden > 0 ? (
                  <ShowAllRow
                    provider={group.provider}
                    total={group.total}
                    onShowAll={(provider) => setExpanded([...expanded, provider])}
                  />
                ) : null}
              </>
            )}
          </CommandGroup>
        ))}
        {groups.showManageProviders ? (
          <>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value={MANAGE_PROVIDERS_VALUE}
                onSelect={handleManageProviders}
                className="text-muted-foreground"
              >
                <Settings2Icon className="size-3.5" />
                Manage providers
              </CommandItem>
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </Command>
  )
}
