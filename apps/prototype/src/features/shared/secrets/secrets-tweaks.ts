import type { Control } from '../../../proto/use-prototype'
import { ESecretsDialog } from './secrets-view'

export const SECRETS_DIALOGS: Readonly<Record<string, ESecretsDialog>> = {
  none: ESecretsDialog.None,
  add: ESecretsDialog.Add,
  'bulk-add': ESecretsDialog.BulkAdd,
}

export const SECRETS_DIALOG_CONTROL = {
  type: 'select',
  label: 'Dialog',
  options: Object.keys(SECRETS_DIALOGS),
  default: 'none',
} satisfies Control
