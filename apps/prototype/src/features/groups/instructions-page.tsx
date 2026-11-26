'use client'

import { InstructionsPage } from '../settings/pages/instructions'
import { InheritedLayersPreview, type InheritedLayer } from './inherited-layers-preview'

const DESCRIPTION =
  "Loaded into every thread on every project of this group, after the personal instructions and before the repository's AGENTS.md files."

const GROUP_INSTRUCTIONS = [
  '# Comp AI',
  '',
  'These instructions reach every project in the Comp AI group.',
  '',
  '## What is worth knowing',
  '',
  '- The group holds comp, comp-neo, comp-private, comp-review, comp-v2 and atlas.',
  '- A secret shared by two or more of them lives in a group access grant, never in two project grants.',
  '',
  '## How to apply',
  '',
  '- Read the project overrides before changing a shared value.',
  '- When a group value is wrong for one project, override it in that project instead of editing the group.',
].join('\n')

const PERSONAL_INSTRUCTIONS_LAYER: InheritedLayer = {
  title: 'From personal settings',
  description: "Loaded first, before this group's text.",
  editHref: '/settings/instructions',
  items: [{ label: 'ATLAS.md', detail: 'Personal instructions, applied to every project' }],
}

export function GroupInstructionsPage() {
  return (
    <div className="flex flex-col gap-8">
      <InstructionsPage
        saved={GROUP_INSTRUCTIONS}
        initial={GROUP_INSTRUCTIONS}
        description={DESCRIPTION}
      />
      <InheritedLayersPreview layers={[PERSONAL_INSTRUCTIONS_LAYER]} />
    </div>
  )
}
