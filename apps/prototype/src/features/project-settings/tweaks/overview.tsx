'use client'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { optionOf } from '../../shared/option-of'
import { EShipBehavior } from '../fixtures/project-settings'
import { EOverviewPicker } from '../overview-model'
import { OverviewPage } from '../overview-page'
import { useProjectFixture } from '../project-fixture-context'

const PICKERS: Record<string, EOverviewPicker | undefined> = {
  none: undefined,
  branch: EOverviewPicker.Branch,
  repository: EOverviewPicker.Repository,
}

const CONTROLS = {
  edited: { type: 'boolean', label: 'Unsaved edits', default: false },
  picker: { type: 'select', label: 'Picker open', options: Object.keys(PICKERS), default: 'none' },
} satisfies Record<string, Control>

export function OverviewTweaked() {
  const project = useProjectFixture()
  const { edited, picker } = usePrototype(CONTROLS)
  return (
    <OverviewPage
      key={`${project.name}-${edited}-${picker}`}
      initial={project}
      draftOverride={
        edited
          ? {
              baseBranch: 'release/0.9',
              shipBehavior: EShipBehavior.Push,
              additionalRepositories: ['dennisofficial/atlas-docs', 'dltech/design-tokens'],
            }
          : undefined
      }
      openPicker={optionOf<EOverviewPicker | undefined>({
        table: PICKERS,
        key: picker,
        fallback: undefined,
      })}
    />
  )
}
