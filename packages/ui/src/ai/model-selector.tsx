'use client'

import { useRef, useState } from 'react'
import { ChevronDownIcon, CornerDownRightIcon } from 'lucide-react'
import { cn } from 'cn'

import { InputGroupButton } from '#components/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '#components/popover'

import { EffortDial } from './effort-dial'
import { ModelList } from './internal/model-selector-list'
import { EModelSelectorVariant } from './model-selector-variant'
import { FastToggle, TriggerLabel } from './internal/model-selector-rows'
import {
  DEFAULT_COLLAPSED_LIMIT,
  type EEffort,
  type ModelOption,
  togglePinned,
} from './model-selector-groups'

export { EModelSelectorVariant }

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

export interface ModelFollow {
  label: string
  active: boolean
  onFollow: () => void
  note?: string
}

export interface ModelSelectorProps {
  models: ModelOption[]
  value: string
  onValueChange?: (id: string) => void
  effort?: EEffort
  onEffortChange?: (effort: EEffort) => void
  effortNote?: string
  showEffortLabel?: boolean
  follow?: ModelFollow
  fast?: boolean
  onFastChange?: (fast: boolean) => void
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
  open?: boolean
  onOpenChange?: (open: boolean) => void
  placeholder?: string
  variant?: EModelSelectorVariant
  className?: string
}

export function ModelSelector({
  models,
  value,
  onValueChange,
  effort,
  onEffortChange,
  effortNote,
  showEffortLabel = false,
  follow,
  fast = false,
  onFastChange,
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
  open: controlledOpen,
  onOpenChange,
  placeholder = 'No model',
  variant = EModelSelectorVariant.Composer,
  className,
}: ModelSelectorProps) {
  const current = models.find((model) => model.id === value)
  const [heldOpen, setHeldOpen] = useState(defaultOpen)
  const open = controlledOpen ?? heldOpen
  const inputRef = useRef<HTMLInputElement>(null)
  const following = follow?.active === true
  const canManageProviders = onManageProviders !== undefined
  const hasNoProviders = models.length === 0 && reconnectProviders.length === 0
  const effortOptions = current?.efforts ?? []
  const note = effortNote ?? follow?.note
  const currentRunnable = current?.disabled !== true
  const showEffort = currentRunnable && effort !== undefined && effortOptions.length > 1
  const showFast =
    currentRunnable && current?.fast === true && (following || onFastChange !== undefined)

  const handleOpenChange = (next: boolean) => {
    setHeldOpen(next)
    onOpenChange?.(next)
  }
  const handleModelSelect = (id: string) => {
    onValueChange?.(id)
    handleOpenChange(false)
  }
  const handleReconnect = (provider: string) => onReconnect?.(provider)
  const handleManageProviders = () => onManageProviders?.()
  const handlePinnedChange = (id: string) => onPinnedChange?.(togglePinned({ pinned, id }))

  return (
    <>
      {following ? (
        <CornerDownRightIcon
          aria-hidden
          data-slot="model-follow"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      ) : null}
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <InputGroupButton
              size="sm"
              data-slot="model-trigger"
              className={cn('min-w-0 shrink justify-start', className)}
            />
          }
        >
          <TriggerLabel
            model={current}
            placeholder={placeholder}
            variant={variant}
            {...(follow === undefined || !follow.active ? {} : { follow: follow.label })}
          />
          <ChevronDownIcon
            className={cn('ml-auto', variant === EModelSelectorVariant.Composer && 'max-md:hidden')}
          />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          initialFocus={hasNoProviders ? true : inputRef}
          className="w-96"
        >
          <ModelList
            models={models}
            value={value}
            pinned={pinned}
            canPin={onPinnedChange !== undefined}
            showRate={showRate}
            canManageProviders={canManageProviders}
            onManageProviders={handleManageProviders}
            reconnectProviders={reconnectProviders}
            reconnectNotes={reconnectNotes}
            onReconnect={handleReconnect}
            collapsedProviders={collapsedProviders}
            collapsedLimit={collapsedLimit}
            {...(follow === undefined ? {} : { follow })}
            onSelect={handleModelSelect}
            onPinToggle={handlePinnedChange}
            onClose={() => handleOpenChange(false)}
            inputRef={inputRef}
          />
        </PopoverContent>
      </Popover>
      {showEffort ? (
        <EffortDial
          efforts={effortOptions}
          value={effort}
          {...(current?.effortLabels === undefined ? {} : { labels: current.effortLabels })}
          {...(note === undefined ? {} : { note })}
          showEffortLabel={showEffortLabel}
          {...(following || onEffortChange === undefined ? {} : { onChange: onEffortChange })}
        />
      ) : null}
      {showFast ? (
        <FastToggle
          pressed={fast}
          readOnly={following}
          variant={variant}
          {...(follow?.note === undefined ? {} : { note: follow.note })}
          {...(onFastChange === undefined ? {} : { onToggle: onFastChange })}
        />
      ) : null}
    </>
  )
}
