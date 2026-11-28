'use client'

import { ChevronDownIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { togglePinned } from '@dltech/atlas-ui/ai/model-selector'
import { TriggerLabel } from '@dltech/atlas-ui/ai/internal/model-selector-rows'
import { InputGroupButton } from '@dltech/atlas-ui/components/input-group'

import type { ModelPickerControlsProps } from './model-picker'
import {
  hideNativePicker,
  type NativePickerEvent,
  nativePickerPayload,
  outcomeOf,
  showNativePicker,
  watchNativePicker,
} from './data/native-model-picker'

export function NativeModelPickerControls({
  picker,
  selection,
  onSelectionChange,
  open,
  onOpenChange,
  follow,
  placeholder = 'Default',
  variant,
  className,
  onNativeUnavailable,
}: ModelPickerControlsProps & { onNativeUnavailable: () => void }) {
  const models = picker.options.models
  const current = models.find((model) => model.id === selection.id)
  const trigger = useRef<HTMLButtonElement | null>(null)

  const handleEvent = (event: NativePickerEvent) => {
    const outcome = outcomeOf({ models, selection, event })
    if (outcome.kind === 'select') {
      onSelectionChange(outcome.selection)
      if (outcome.dismiss) onOpenChange?.(false)
      return
    }
    if (outcome.kind === 'pin') {
      if (outcome.id !== '') {
        picker.onPinnedChange(togglePinned({ pinned: picker.pinned, id: outcome.id }))
      }
      return
    }
    if (outcome.kind === 'error') console.error(outcome.message)
    onOpenChange?.(false)
  }

  const latest = useRef(handleEvent)
  latest.current = handleEvent

  useEffect(() => watchNativePicker({ host: window, onPick: (event) => latest.current(event) }), [])

  useEffect(() => () => hideNativePicker({ host: window }), [])

  const showPanel = async () => {
    const rect = trigger.current?.getBoundingClientRect()
    if (rect === undefined) {
      onNativeUnavailable()
      onOpenChange?.(true)
      return
    }
    const shown = await showNativePicker({
      host: window,
      anchor: rect,
      payload: nativePickerPayload({ models, selection, pinned: picker.pinned }),
    })
    if (shown) return
    onNativeUnavailable()
    onOpenChange?.(true)
  }

  useEffect(() => {
    if (open === true) void showPanel()
    else hideNativePicker({ host: window })
  }, [open])

  const handleClick = () => {
    if (open === undefined) {
      void showPanel()
      return
    }
    onOpenChange?.(true)
  }

  return (
    <InputGroupButton
      ref={trigger}
      size="sm"
      data-slot="model-trigger"
      aria-label="Choose a model"
      className={`min-w-0 shrink justify-start${className === undefined ? '' : ` ${className}`}`}
      onClick={handleClick}
    >
      <TriggerLabel
        model={current}
        placeholder={placeholder}
        {...(variant === undefined ? {} : { variant })}
        {...(follow === undefined || !follow.active ? {} : { follow: follow.label })}
      />
      <ChevronDownIcon className="ml-auto" />
    </InputGroupButton>
  )
}
