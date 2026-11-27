import { EffortSelect } from '../../composer/effort-select'
import { FastToggle } from '../../composer/model-controls'
import { ModelSelect } from '../../composer/model-picker'
import type { SessionModelSheet } from './use-session-model-choice'

export const SessionModelControls = ({
  model,
  onOpenModel,
}: {
  model: SessionModelSheet
  onOpenModel: () => void
}) => {
  const { selection } = model

  const handleEffort = (effort: string) => {
    if (selection === null) return
    model.onSelect({ ...selection, effort })
  }

  const handleOpenChange = (open: boolean) => {
    if (open) {
      onOpenModel()
      return
    }
    model.onClose()
  }

  const handleFast = (fast: boolean) => {
    if (selection === null) return
    model.onSelect({ ...selection, fast })
  }

  return (
    <>
      <ModelSelect
        models={model.models}
        selection={selection}
        pinned={model.pinned}
        pinnedRef={model.pinnedRef}
        personalId={model.personalId}
        open={model.open}
        onOpenChange={handleOpenChange}
        onPinnedChange={model.onPinnedChange}
        onSelect={model.onSelect}
      />
      {selection === null || selection.model.efforts.length === 0 ? null : (
        <EffortSelect selection={selection} onChange={handleEffort} />
      )}
      {selection?.model.fast ? <FastToggle selection={selection} onToggle={handleFast} /> : null}
    </>
  )
}
