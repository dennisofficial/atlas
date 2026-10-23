import type { ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import {
  EMPTY_MEMORY_GROUP,
  MEMORY_RS_CRM_GROUP_ID,
  MEMORY_SCOPE_GROUPS,
} from '../../fixtures/settings-memory'
import { MemoryPage } from './pages/memory'
import { ESettingsPage } from './settings-nav'
import { renderSettingsPage } from './settings-pages'
import { SettingsShell } from './settings-shell'

const meta = {
  title: 'App/Settings/Memory',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function memoryStory(page: ReactNode): Story {
  return {
    render: () => (
      <SettingsShell
        initialPage={ESettingsPage.Memory}
        renderPage={(current) =>
          current === ESettingsPage.Memory ? page : renderSettingsPage(current)
        }
      />
    ),
  }
}

export const Default: Story = {
  render: () => (
    <SettingsShell initialPage={ESettingsPage.Memory} renderPage={renderSettingsPage} />
  ),
}

export const ProjectScope: Story = memoryStory(
  <MemoryPage initialGroupId={MEMORY_RS_CRM_GROUP_ID} />,
)

export const ViewerOpen: Story = memoryStory(
  <MemoryPage defaultOpenMemoryName="questions-end-the-turn" />,
)

export const EditOpen: Story = memoryStory(
  <MemoryPage defaultOpenMemoryName="questions-end-the-turn" defaultEditing />,
)

export const Empty: Story = memoryStory(
  <MemoryPage
    initialGroups={[...MEMORY_SCOPE_GROUPS, EMPTY_MEMORY_GROUP]}
    initialGroupId={EMPTY_MEMORY_GROUP.id}
  />,
)
