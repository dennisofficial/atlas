'use client'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { MCP_DIALOGS, MCP_DIALOG_CONTROL } from '../../shared/mcp/mcp-tweaks'
import { EMcpDialog } from '../../shared/mcp/mcp-view'
import { optionOf } from '../../shared/option-of'
import {
  MCP_IMPORT_SAMPLE,
  OAUTH_STATE_MCP_SERVERS,
  PERSONAL_MCP_SERVERS,
  type McpServer,
} from '../fixtures/settings-mcp'
import { IntegrationsPage } from '../pages/integrations'

const DATA: Record<string, McpServer[]> = {
  populated: PERSONAL_MCP_SERVERS,
  empty: [],
  'oauth-states': OAUTH_STATE_MCP_SERVERS,
}

const CONTROLS = {
  data: { type: 'select', label: 'Data', options: Object.keys(DATA), default: 'populated' },
  dialog: MCP_DIALOG_CONTROL,
} satisfies Record<string, Control>

export function IntegrationsTweaked() {
  const { data, dialog } = usePrototype(CONTROLS)
  const openDialog = optionOf({ table: MCP_DIALOGS, key: dialog, fallback: EMcpDialog.None })
  return (
    <IntegrationsPage
      key={`${data}-${dialog}`}
      initial={optionOf({ table: DATA, key: data, fallback: PERSONAL_MCP_SERVERS })}
      openDialog={openDialog}
      initialJson={openDialog === EMcpDialog.PasteJson ? MCP_IMPORT_SAMPLE : ''}
    />
  )
}
