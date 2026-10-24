import type { KeyboardEvent, MouseEvent } from 'react'
import { ChevronDownIcon, PinIcon, TriangleAlertIcon } from 'lucide-react'
import { cn } from 'cn'

import { BrandMark } from '#components/brand-mark'
import { Button } from '#components/button'
import { CommandItem } from '#components/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#components/dropdown-menu'
import { InputGroupButton } from '#components/input-group'
import { Toggle } from '#components/toggle'

import {
  EFFORT_LABELS,
  EFFORT_LADDER,
  MODEL_FILTER_LABELS,
  type EEffort,
  reconnectItemValue,
  showAllItemValue,
  type EModelFilter,
  type ModelOption,
} from '../model-selector-groups'

export function ProviderMark({ model }: { model: ModelOption }) {
  if (model.brand)
    return <BrandMark brand={model.brand} className="size-5 border-0 bg-transparent" />
  return (
    <span
      aria-hidden
      className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-muted text-[0.65rem] font-semibold uppercase"
    >
      {model.monogram}
    </span>
  )
}

export function TriggerLabel({ model }: { model: ModelOption | undefined }) {
  if (!model) return <>No model</>
  return (
    <>
      <ProviderMark model={model} />
      <span className="min-w-0 truncate">
        {model.label}
        {model.route ? <span className="text-muted-foreground"> · {model.route}</span> : null}
      </span>
    </>
  )
}

interface ModelRowProps {
  model: ModelOption
  checked: boolean
  pinned: boolean
  canPin: boolean
  showRate: boolean
  showRoute: boolean
  onSelect: (id: string) => void
  onTogglePin: (id: string) => void
}

export function ModelRow({
  model,
  checked,
  pinned,
  canPin,
  showRate,
  showRoute,
  onSelect,
  onTogglePin,
}: ModelRowProps) {
  const handleSelect = () => onSelect(model.id)
  const handlePinMouseDown = (event: MouseEvent) => event.preventDefault()
  const handlePinKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
  }
  const handlePinClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onTogglePin(model.id)
  }

  return (
    <CommandItem value={model.id} data-checked={checked} onSelect={handleSelect} className="h-8">
      <ProviderMark model={model} />
      <span className="min-w-0 flex-1 truncate" title={model.label}>
        {model.label}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
        {showRoute && model.route ? <span>{model.route}</span> : null}
        {model.context ? <span className="w-9 text-right">{model.context}</span> : null}
        {showRate && model.rate ? <span className="min-w-16 text-right">{model.rate}</span> : null}
      </span>
      {canPin ? (
        <button
          type="button"
          aria-label={pinned ? `Unpin ${model.label}` : `Pin ${model.label}`}
          aria-pressed={pinned}
          onMouseDown={handlePinMouseDown}
          onKeyDown={handlePinKeyDown}
          onClick={handlePinClick}
          className={cn(
            'pointer-events-auto flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
            pinned
              ? 'text-foreground'
              : 'opacity-0 group-hover/command-item:opacity-100 group-data-selected/command-item:opacity-100 focus-visible:opacity-100',
          )}
        >
          <PinIcon className={cn('size-3.5', pinned && 'fill-current')} />
        </button>
      ) : null}
    </CommandItem>
  )
}

export function ShowAllRow({
  provider,
  total,
  onShowAll,
}: {
  provider: string
  total: number
  onShowAll: (provider: string) => void
}) {
  const handleSelect = () => onShowAll(provider)
  return (
    <CommandItem
      value={showAllItemValue(provider)}
      onSelect={handleSelect}
      aria-label={`Show all ${total} ${provider} models`}
      className="h-8 text-muted-foreground"
    >
      <span className="size-5 shrink-0" aria-hidden />
      Show all {total}
    </CommandItem>
  )
}

export function FilterChips({
  filters,
  active,
  onToggle,
}: {
  filters: readonly EModelFilter[]
  active: readonly EModelFilter[]
  onToggle: (filter: EModelFilter) => void
}) {
  return (
    <fieldset
      aria-label="Filter models"
      className="m-0 flex min-w-0 flex-wrap gap-1 border-0 px-1 pt-1.5"
    >
      {filters.map((filter) => (
        <Toggle
          key={filter}
          size="sm"
          variant="outline"
          pressed={active.includes(filter)}
          onPressedChange={() => onToggle(filter)}
          className="h-6 min-w-0 px-2 text-xs"
        >
          {MODEL_FILTER_LABELS[filter]}
        </Toggle>
      ))}
    </fieldset>
  )
}

export function ReconnectRow({
  provider,
  note,
  onReconnect,
}: {
  provider: string
  note?: string
  onReconnect: (provider: string) => void
}) {
  const handleSelect = () => onReconnect(provider)
  return (
    <CommandItem
      value={reconnectItemValue(provider)}
      onSelect={handleSelect}
      aria-label={`${provider}: ${note ?? 'sign-in expired'}. Reconnect`}
      className="h-8"
    >
      <TriangleAlertIcon className="size-3.5 text-warning/80" />
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {note ?? 'Sign-in expired'}
      </span>
      <span className="shrink-0 text-xs text-primary underline-offset-4 group-hover/command-item:underline group-data-selected/command-item:underline">
        Reconnect
      </span>
    </CommandItem>
  )
}

export function NoProvidersState({
  canConnect,
  onConnect,
}: {
  canConnect: boolean
  onConnect: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">No providers connected</p>
        <p className="text-xs text-muted-foreground">Connect a provider to choose a model.</p>
      </div>
      {canConnect ? (
        <Button size="sm" variant="outline" onClick={onConnect}>
          Connect a provider
        </Button>
      ) : null}
    </div>
  )
}

export function EffortMenu({
  efforts,
  value,
  onChange,
}: {
  efforts: readonly EEffort[]
  value: EEffort
  onChange: (effort: EEffort) => void
}) {
  const handleValueChange = (next: string) => {
    const match = EFFORT_LADDER.find((effort) => effort === next)
    if (match) onChange(match)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <InputGroupButton
            size="sm"
            data-slot="model-effort"
            aria-label={`Effort: ${EFFORT_LABELS[value]}`}
          />
        }
      >
        {EFFORT_LABELS[value]}
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={value} onValueChange={handleValueChange}>
          {efforts.map((option) => (
            <DropdownMenuRadioItem key={option} value={option} closeOnClick>
              {EFFORT_LABELS[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
