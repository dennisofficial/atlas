import type { ComponentProps } from 'react'
import { EffortSelect, FastToggle } from '../../composer/model-controls'
import { ModelTrigger } from '../../composer/model-trigger'
import type { SessionModelSheet } from './use-session-model-choice'

export const SessionModelControls = ({
  model,
  onOpenModel,
}: {
  model: SessionModelSheet
  onOpenModel: ComponentProps<typeof ModelTrigger>['onPress']
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
      <ModelTrigger
        models={model.models}
        selection={selection}
        pinnedRef={model.pinnedRef}
        onPress={onOpenModel}
      />
      {selection === null || selection.model.efforts.length === 0 ? null : (
        <EffortSelect selection={selection} onChange={handleEffort} />
      )}
      {selection?.model.fast ? <FastToggle selection={selection} onToggle={handleFast} /> : null}
    </>
  )
}
