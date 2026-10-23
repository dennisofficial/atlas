import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { MCP_IMPORT_SAMPLE, OAUTH_STATE_MCP_SERVERS } from '../../fixtures/settings-mcp'
import { EMcpDialog } from '../shared/mcp/mcp-view'
import { McpPage } from './pages/mcp'
import { ESettingsPage } from './settings-nav'
import { SettingsShell } from './settings-shell'

const meta = {
  title: 'App/Settings/MCP',
  parameters: { layout: 'fullscreen' },
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function shell(page: ReturnType<typeof McpPage>) {
  return <SettingsShell initialPage={ESettingsPage.Mcp} renderPage={() => page} />
}

export const Default: Story = { render: () => shell(<McpPage />) }

export const Empty: Story = { render: () => shell(<McpPage initial={[]} />) }

export const AddForm: Story = {
  render: () => shell(<McpPage openDialog={EMcpDialog.Add} />),
}

export const AddPasteJson: Story = {
  render: () =>
    shell(<McpPage openDialog={EMcpDialog.PasteJson} initialJson={MCP_IMPORT_SAMPLE} />),
}

export const OAuthStates: Story = {
  render: () => shell(<McpPage initial={OAUTH_STATE_MCP_SERVERS} />),
}
