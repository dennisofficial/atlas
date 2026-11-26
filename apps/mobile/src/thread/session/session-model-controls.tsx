import { EffortSelect } from '../../composer/effort-select'
import { FastToggle } from '../../composer/model-controls'
import { ModelMenu } from '../../composer/model-menu'
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

  const handleFast = (fast: boolean) => {
    if (selection === null) return
    model.onSelect({ ...selection, fast })
  }

  return (
    <>
      <ModelMenu
        models={model.models}
        selection={selection}
        pinnedRef={model.pinnedRef}
        pinned={model.pinned}
        onSelect={model.onSelect}
        onOpenAll={onOpenModel}
      />
      {selection === null || selection.model.efforts.length === 0 ? null : (
        <EffortSelect selection={selection} onChange={handleEffort} />
      )}
      {selection?.model.fast ? <FastToggle selection={selection} onToggle={handleFast} /> : null}
    </>
  )
}
