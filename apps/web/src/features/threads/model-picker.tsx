'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { EModelSelectorVariant, ModelSelector } from '@dltech/atlas-ui/ai/model-selector'

import { PROVIDERS_HREF } from '@/features/settings/settings-nav'

import type { ModelPicker } from './data/use-model-picker'
import type { ModelSelection } from './data/model-selection'
import { selectionAfterPick } from './data/model-selection'
import { nativePickerAvailable } from './data/native-model-picker'
import { NativeModelPickerControls } from './native-model-picker'

export type PickerFollow = {
  label: string
  active: boolean
  onFollow: () => void
  note?: string
}

export type ModelPickerControlsProps = {
  picker: ModelPicker
  selection: ModelSelection
  onSelectionChange: (selection: ModelSelection) => void
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
  follow?: PickerFollow | undefined
  effortReadOnly?: boolean
  effortNote?: string | undefined
  showEffortLabel?: boolean
  placeholder?: string | undefined
  variant?: EModelSelectorVariant | undefined
  className?: string | undefined
}

export function ModelPickerControls({
  native = false,
  ...props
}: ModelPickerControlsProps & { native?: boolean }) {
  const router = useRouter()
  const [nativeUnavailable, setNativeUnavailable] = useState(false)
  const handleManage = () => router.push(PROVIDERS_HREF)
  if (
    native &&
    !nativeUnavailable &&
    typeof window !== 'undefined' &&
    nativePickerAvailable(window)
  ) {
    return (
      <NativeModelPickerControls
        {...props}
        onNativeUnavailable={() => setNativeUnavailable(true)}
      />
    )
  }
  return <ModelSelectorControls {...props} onManage={handleManage} />
}

function ModelSelectorControls({
  picker,
  selection,
  onSelectionChange,
  open,
  onOpenChange,
  follow,
  effortReadOnly = false,
  effortNote,
  showEffortLabel = false,
  placeholder = 'Default',
  variant,
  className,
  onManage,
}: ModelPickerControlsProps & { onManage: () => void }) {
  const { models, reconnectProviders } = picker.options
  const handleValueChange = (id: string) =>
    onSelectionChange(
      selectionAfterPick({ models, id, effort: selection.effort, fast: selection.fast }),
    )
  const handleEffortChange = (effort: ModelSelection['effort']) =>
    onSelectionChange({ ...selection, effort })
  return (
    <ModelSelector
      models={models}
      value={selection.id}
      placeholder={placeholder}
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange === undefined ? {} : { onOpenChange })}
      onValueChange={handleValueChange}
      effort={selection.effort}
      {...(effortReadOnly ? {} : { onEffortChange: handleEffortChange })}
      {...(effortNote === undefined ? {} : { effortNote })}
      showEffortLabel={showEffortLabel}
      {...(follow === undefined ? {} : { follow })}
      fast={selection.fast}
      onFastChange={(fast) => onSelectionChange({ ...selection, fast })}
      pinned={picker.pinned}
      onPinnedChange={picker.onPinnedChange}
      reconnectProviders={reconnectProviders}
      onReconnect={onManage}
      onManageProviders={onManage}
      {...(variant === undefined ? {} : { variant })}
      {...(className === undefined ? {} : { className })}
    />
  )
}
