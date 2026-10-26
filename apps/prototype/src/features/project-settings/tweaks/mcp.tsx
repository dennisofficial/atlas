'use client'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { MCP_DIALOGS, MCP_DIALOG_CONTROL } from '../../shared/mcp/mcp-tweaks'
import { EMcpDialog } from '../../shared/mcp/mcp-view'
import { optionOf } from '../../shared/option-of'
import { MCP_IMPORT_SAMPLE } from '../../settings/fixtures/settings-mcp'
import { McpPage } from '../mcp-page'

const CONTROLS = {
  data: { type: 'select', label: 'Data', options: ['configured', 'empty'], default: 'configured' },
  dialog: MCP_DIALOG_CONTROL,
} satisfies Record<string, Control>

export function McpTweaked() {
  const { data, dialog } = usePrototype(CONTROLS)
  const openDialog = optionOf({ table: MCP_DIALOGS, key: dialog, fallback: EMcpDialog.None })
  return (
    <McpPage
      key={`${data}-${dialog}`}
      {...(data === 'empty' ? { initialRows: [] } : {})}
      openDialog={openDialog}
      initialJson={openDialog === EMcpDialog.PasteJson ? MCP_IMPORT_SAMPLE : ''}
    />
  )
}
