'use client'

import { useRef, useState } from 'react'
import { ChevronDownIcon, Settings2Icon } from 'lucide-react'

import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '#components/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#components/dropdown-menu'
import { InputGroupButton } from '#components/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '#components/popover'

import { ModelRow, NoProvidersState, ReconnectRow } from './internal/model-selector-rows'
import {
  EModelSelectorState,
  EProviderGroupKind,
  MANAGE_PROVIDERS_VALUE,
  firstItemValue,
  modelSelectorGroups,
  togglePinned,
  type ModelOption,
} from './model-selector-groups'

export {
  EModelSelectorState,
  EProviderGroupKind,
  groupByProvider,
  modelSelectorGroups,
  togglePinned,
  type ModelOption,
  type ModelSelectorGroups,
  type ProviderGroup,
  type ProviderModels,
} from './model-selector-groups'

export enum EEffort {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

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
  onReconnect?: (provider: string) => void
  onManageProviders?: () => void
  defaultOpen?: boolean
}

const EFFORT_LABEL: Record<EEffort, string> = {
  [EEffort.Low]: 'Low',
  [EEffort.Medium]: 'Medium',
  [EEffort.High]: 'High',
}

const EFFORTS = [EEffort.Low, EEffort.Medium, EEffort.High]

function isEffort(value: string): value is EEffort {
  return EFFORTS.some((effort) => effort === value)
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
  onReconnect,
  onManageProviders,
  defaultOpen = false,
}: ModelSelectorProps) {
  const current = models.find((model) => model.id === value) ?? models[0]
  const [open, setOpen] = useState(defaultOpen)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(current?.id ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  const canManageProviders = onManageProviders !== undefined
  const groupsFor = (nextQuery: string) =>
    modelSelectorGroups({
      models,
      query: nextQuery,
      pinned,
      reconnectProviders,
      canManageProviders,
    })
  const groups = groupsFor(query)
  const pinnedIds = new Set(groups.pinned.map((model) => model.id))
  const canPin = onPinnedChange !== undefined
  const hasNoProviders = groups.state === EModelSelectorState.NoProviders

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    setQuery('')
    if (next) setHighlighted(current?.id ?? firstItemValue(groupsFor('')) ?? '')
  }
  const handleQueryChange = (next: string) => {
    setQuery(next)
    const first = firstItemValue(groupsFor(next)) ?? ''
    setHighlighted(next.trim().length === 0 ? (current?.id ?? first) : first)
  }
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
  const handleEffortChange = (next: string) => {
    if (isEffort(next)) onEffortChange?.(next)
  }

  const renderRow = (model: ModelOption) => (
    <ModelRow
      key={model.id}
      model={model}
      checked={model.id === current?.id}
      pinned={pinnedIds.has(model.id)}
      canPin={canPin}
      showRate={showRate}
      onSelect={handleModelSelect}
      onTogglePin={handleTogglePin}
    />
  )

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger render={<InputGroupButton size="sm" />}>
          {current?.label ?? 'No model'}
          <ChevronDownIcon />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          initialFocus={hasNoProviders ? true : inputRef}
          className="w-80 gap-0 p-0"
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
              <CommandList className="max-h-80">
                {groups.state === EModelSelectorState.NoMatches ? (
                  <p role="status" className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No models match “{query.trim()}”
                  </p>
                ) : null}
                {groups.pinned.length > 0 ? (
                  <CommandGroup heading="Pinned">{groups.pinned.map(renderRow)}</CommandGroup>
                ) : null}
                {groups.providers.map((group) => (
                  <CommandGroup key={group.provider} heading={group.provider}>
                    {group.kind === EProviderGroupKind.Reconnect ? (
                      <ReconnectRow provider={group.provider} onReconnect={handleReconnect} />
                    ) : (
                      group.models.map(renderRow)
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
      {effort ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<InputGroupButton size="sm" />}>
            {EFFORT_LABEL[effort]}
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup value={effort} onValueChange={handleEffortChange}>
              {EFFORTS.map((option) => (
                <DropdownMenuRadioItem key={option} value={option} closeOnClick>
                  {EFFORT_LABEL[option]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  )
}
