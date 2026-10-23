import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  ACCESS_CLAUDE_EXPIRED,
  ACCESS_NONE,
  ACCESS_OPENROUTER_ONLY,
  EAgentRole,
  RECONNECT_MODELS_CONFIG,
} from '../../fixtures/settings-models'
import { ModelsEffortPage } from './pages/models-effort'
import { ESettingsPage } from './settings-nav'
import { renderSettingsPage } from './settings-pages'
import { SettingsShell } from './settings-shell'

const meta = {
  title: 'Views/Settings/Models & Effort',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

const modelsStory = (page: ReactNode): Story => ({
  render: () => (
    <SettingsShell
      initialPage={ESettingsPage.ModelsEffort}
      renderPage={(current) =>
        current === ESettingsPage.ModelsEffort ? page : renderSettingsPage(current)
      }
    />
  ),
})

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.ModelsEffort} renderPage={renderSettingsPage} />
  ),
}

export const Dirty: Story = modelsStory(<ModelsEffortPage startEdited />)

export const NoProviders: Story = modelsStory(<ModelsEffortPage access={ACCESS_NONE} />)

export const ReconnectNeeded: Story = modelsStory(
  <ModelsEffortPage initialConfig={RECONNECT_MODELS_CONFIG} access={ACCESS_CLAUDE_EXPIRED} />,
)

export const OpenRouterOnly: Story = modelsStory(
  <ModelsEffortPage access={ACCESS_OPENROUTER_ONLY} />,
)

export const PickerOpen: Story = modelsStory(<ModelsEffortPage openRole={EAgentRole.Main} />)

export const CatalogueSearch: Story = modelsStory(<ModelsEffortPage initialQuery="opus" />)
