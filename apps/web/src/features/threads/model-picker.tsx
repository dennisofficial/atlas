'use client'

import { useRouter } from 'next/navigation'

import { ModelSelector } from '@dltech/atlas-ui/ai/model-selector'

import type { ModelPicker } from './data/use-model-picker'
import type { ModelSelection } from './data/model-selection'
import { selectionAfterPick } from './data/model-selection'

const PROVIDERS_HREF = '/settings/providers'

export function ModelPickerControls({
  picker,
  selection,
  onSelectionChange,
}: {
  picker: ModelPicker
  selection: ModelSelection
  onSelectionChange: (selection: ModelSelection) => void
}) {
  const router = useRouter()
  const { models, reconnectProviders } = picker.options
  const handleManage = () => router.push(PROVIDERS_HREF)
  const handleValueChange = (id: string) =>
    onSelectionChange(selectionAfterPick({ models, id, effort: selection.effort }))
  return (
    <ModelSelector
      models={models}
      value={selection.id}
      placeholder="Default"
      onValueChange={handleValueChange}
      effort={selection.effort}
      onEffortChange={(effort) => onSelectionChange({ ...selection, effort })}
      pinned={picker.pinned}
      onPinnedChange={picker.onPinnedChange}
      reconnectProviders={reconnectProviders}
      onReconnect={handleManage}
      onManageProviders={handleManage}
    />
  )
}
