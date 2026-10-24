'use client'

import { useRef, useState } from 'react'
import { ChevronDownIcon, Settings2Icon } from 'lucide-react'
import { cn } from 'cn'

import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '#components/command'
import { InputGroupButton } from '#components/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '#components/popover'

import {
  EffortMenu,
  FilterChips,
  ModelRow,
  NoProvidersState,
  ReconnectRow,
  ShowAllRow,
  TriggerLabel,
} from './internal/model-selector-rows'
import {
  DEFAULT_COLLAPSED_LIMIT,
  DEFAULT_EFFORTS,
  EModelSelectorState,
  EProviderGroupKind,
  MANAGE_PROVIDERS_VALUE,
  availableFilters,
  firstItemValue,
  modelSelectorGroups,
  togglePinned,
  type EEffort,
  type EModelFilter,
  type ModelOption,
} from './model-selector-groups'

export {
  EEffort,
  EFFORT_LABELS,
  EFFORT_LADDER,
  EModelFilter,
  EModelSelectorState,
  EProviderGroupKind,
  LONG_CONTEXT_TOKENS,
  MODEL_FILTER_LABELS,
  MODEL_FILTER_ORDER,
  groupByProvider,
  includesAll,
  modelSelectorGroups,
  queryTerms,
  togglePinned,
  type ModelOption,
  type ModelSelectorGroups,
  type ProviderGroup,
  type ProviderModels,
} from './model-selector-groups'

export interface ModelSelectorProps {
  models: ModelOption[]
  value: string
  onValueChange?: (id: string) => void
  effort?: EEffort
  onEffortChange?: (effort: EEffort) => void
  showRate?: boolean
  pinned?: string[]
  onPinnedChange?: (ids: string[]) => void
  reconnectProviders?: string[]
  reconnectNotes?: Record<string, string>
  onReconnect?: (provider: string) => void
  onManageProviders?: () => void
  collapsedProviders?: string[]
  collapsedLimit?: number
  defaultOpen?: boolean
  className?: string
}

export function ModelSelector({
  models,
  value,
  onValueChange,
  effort,
  onEffortChange,
  showRate = true,
  pinned = [],
  onPinnedChange,
  reconnectProviders = [],
  reconnectNotes = {},
  onReconnect,
  onManageProviders,
  collapsedProviders = [],
  collapsedLimit = DEFAULT_COLLAPSED_LIMIT,
  defaultOpen = false,
  className,
}: ModelSelectorProps) {
  const current = models.find((model) => model.id === value) ?? models[0]
  const [open, setOpen] = useState(defaultOpen)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<EModelFilter[]>([])
  const [expanded, setExpanded] = useState<string[]>([])
  const [highlighted, setHighlighted] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const canManageProviders = onManageProviders !== undefined
  const groupsFor = ({
    nextQuery,
    nextFilters,
  }: {
    nextQuery: string
    nextFilters: EModelFilter[]
  }) =>
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
  const canPin = onPinnedChange !== undefined
  const hasNoProviders = groups.state === EModelSelectorState.NoProviders
  const routedProviders = new Set(models.flatMap((model) => (model.route ? [model.provider] : [])))
  const effortOptions = current?.efforts ?? DEFAULT_EFFORTS

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    setQuery('')
    setFilters([])
    setExpanded([])
    if (next) setHighlighted(firstItemValue(groupsFor({ nextQuery: '', nextFilters: [] })) ?? '')
  }
  const handleQueryChange = (next: string) => {
    setQuery(next)
    setHighlighted(firstItemValue(groupsFor({ nextQuery: next, nextFilters: filters })) ?? '')
  }
  const handleFilterToggle = (filter: EModelFilter) => {
    const next = filters.includes(filter)
      ? filters.filter((active) => active !== filter)
      : [...filters, filter]
    setFilters(next)
    setHighlighted(firstItemValue(groupsFor({ nextQuery: query, nextFilters: next })) ?? '')
  }
  const handleShowAll = (provider: string) => setExpanded([...expanded, provider])
  const handleModelSelect = (id: string) => {
    onValueChange?.(id)
    handleOpenChange(false)
  }
  const handleReconnect = (provider: string) => {
    onReconnect?.(provider)
    handleOpenChange(false)
  }
  const handleManageProviders = () => {
    onManageProviders?.()
    handleOpenChange(false)
  }
  const handleTogglePin = (id: string) => onPinnedChange?.(togglePinned({ pinned, id }))
  const handleEffortChange = (next: EEffort) => onEffortChange?.(next)

  const renderRow = (model: ModelOption, showRoute: boolean) => (
    <ModelRow
      key={model.id}
      model={model}
      checked={model.id === current?.id}
      pinned={pinnedIds.has(model.id)}
      canPin={canPin}
      showRate={showRate}
      showRoute={showRoute}
      onSelect={handleModelSelect}
      onTogglePin={handleTogglePin}
    />
  )

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={<InputGroupButton size="sm" className={cn('min-w-0 justify-start', className)} />}
        >
          <TriggerLabel model={current} />
          <ChevronDownIcon className="ml-auto" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          initialFocus={hasNoProviders ? true : inputRef}
          className="w-96 gap-0 p-0"
        >
          {hasNoProviders ? (
            <NoProvidersState canConnect={canManageProviders} onConnect={handleManageProviders} />
          ) : (
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
                <FilterChips
                  filters={filterOptions}
                  active={filters}
                  onToggle={handleFilterToggle}
                />
              ) : null}
              <CommandList className="max-h-96">
                {groups.state === EModelSelectorState.NoMatches ? (
                  <p role="status" className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No models match{query.trim() ? ` “${query.trim()}”` : ' these filters'}
                  </p>
                ) : null}
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
                            onShowAll={handleShowAll}
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
                        className="h-8 text-muted-foreground"
                      >
                        <Settings2Icon className="size-3.5" />
                        Manage providers
                      </CommandItem>
                    </CommandGroup>
                  </>
                ) : null}
              </CommandList>
            </Command>
          )}
        </PopoverContent>
      </Popover>
      {effort && effortOptions.length > 0 ? (
        <>
          <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />
          <EffortMenu efforts={effortOptions} value={effort} onChange={handleEffortChange} />
        </>
      ) : null}
    </>
  )
}
