import type { Control } from '../../../proto/use-prototype'
import { EMcpDialog } from './mcp-view'

export const MCP_DIALOGS: Readonly<Record<string, EMcpDialog>> = {
  none: EMcpDialog.None,
  add: EMcpDialog.Add,
  'paste-json': EMcpDialog.PasteJson,
}

export const MCP_DIALOG_CONTROL = {
  type: 'select',
  label: 'Dialog',
  options: Object.keys(MCP_DIALOGS),
  default: 'none',
} satisfies Control
