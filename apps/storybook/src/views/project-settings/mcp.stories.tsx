import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { EProjectSettingsPage } from '../../fixtures/project-settings'
import { MCP_IMPORT_SAMPLE } from '../../fixtures/settings-mcp'
import { EMcpDialog } from '../shared/mcp/mcp-view'
import { McpPage } from './mcp-page'
import { ProjectSettingsShell } from './project-settings-shell'

const meta = {
  title: 'Views/Project Settings/MCP',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function shell(page: ReturnType<typeof McpPage>) {
  return <ProjectSettingsShell active={EProjectSettingsPage.Mcp}>{page}</ProjectSettingsShell>
}

export const Configured: Story = { render: () => shell(<McpPage />) }

export const Empty: Story = { render: () => shell(<McpPage initialRows={[]} />) }

export const AddForm: Story = {
  render: () => shell(<McpPage openDialog={EMcpDialog.Add} />),
}

export const AddPasteJson: Story = {
  render: () =>
    shell(<McpPage openDialog={EMcpDialog.PasteJson} initialJson={MCP_IMPORT_SAMPLE} />),
}
