import { EffortSelect } from '../../composer/effort-select'
import { FastToggle } from '../../composer/model-controls'
import { ModelSelect } from '../../composer/model-picker'
import type { SessionModelChoice } from './use-session-model-choice'

export const SessionModelControls = ({ model }: { model: SessionModelChoice }) => {
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
      <ModelSelect
        models={model.models}
        selection={selection}
        pinnedRef={model.pinnedRef}
        onSelect={model.onSelect}
      />
      {selection === null || selection.model.efforts.length === 0 ? null : (
        <EffortSelect selection={selection} onChange={handleEffort} />
      )}
      {selection?.model.fast ? <FastToggle selection={selection} onToggle={handleFast} /> : null}
    </>
  )
}
