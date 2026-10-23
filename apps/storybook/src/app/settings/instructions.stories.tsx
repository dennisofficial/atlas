import type { ComponentProps } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import {
  GLOBAL_INSTRUCTIONS,
  GLOBAL_INSTRUCTIONS_RICH,
  OVER_LIMIT_INSTRUCTIONS,
} from '@dltech/atlas-ui/fixtures/settings-agent'
import { InstructionsPage } from './pages/instructions'
import { ESettingsPage } from './settings-nav'
import { renderSettingsPage } from './settings-pages'
import { SettingsShell } from './settings-shell'

const meta = {
  title: 'App/Settings/Instructions',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function renderInstructions(props: ComponentProps<typeof InstructionsPage>) {
  return (
    <SettingsShell
      initialPage={ESettingsPage.Instructions}
      renderPage={(page) =>
        page === ESettingsPage.Instructions ? (
          <InstructionsPage {...props} />
        ) : (
          renderSettingsPage(page)
        )
      }
    />
  )
}

export const Default: Story = {
  render: () => renderInstructions({}),
}

export const Dirty: Story = {
  render: () =>
    renderInstructions({
      saved: GLOBAL_INSTRUCTIONS_RICH,
      initial: `${GLOBAL_INSTRUCTIONS_RICH}\n## Testing\n- Use bun test, never vitest, outside evals.\n`,
    }),
}

export const OverLimit: Story = {
  render: () =>
    renderInstructions({ saved: GLOBAL_INSTRUCTIONS_RICH, initial: OVER_LIMIT_INSTRUCTIONS }),
}

export const SourceFallback: Story = {
  render: () => renderInstructions({ saved: GLOBAL_INSTRUCTIONS }),
}
