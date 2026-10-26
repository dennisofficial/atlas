'use client'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { optionOf } from '../../shared/option-of'
import { SECRETS_DIALOGS, SECRETS_DIALOG_CONTROL } from '../../shared/secrets/secrets-tweaks'
import { ESecretsDialog } from '../../shared/secrets/secrets-view'
import { BULK_ADD_SAMPLE } from '../../settings/fixtures/settings-library'
import { PROJECT_SECRET_ROWS } from '../fixtures/project-settings'
import { SecretsPage } from '../secrets-page'

const CONTROLS = {
  data: { type: 'select', label: 'Data', options: ['populated', 'empty'], default: 'populated' },
  dialog: SECRETS_DIALOG_CONTROL,
} satisfies Record<string, Control>

export function SecretsTweaked() {
  const { data, dialog } = usePrototype(CONTROLS)
  const openDialog = optionOf({
    table: SECRETS_DIALOGS,
    key: dialog,
    fallback: ESecretsDialog.None,
  })
  return (
    <SecretsPage
      key={`${data}-${dialog}`}
      initialRows={data === 'empty' ? [] : PROJECT_SECRET_ROWS}
      openDialog={openDialog}
      bulkText={openDialog === ESecretsDialog.BulkAdd ? BULK_ADD_SAMPLE : ''}
    />
  )
}
