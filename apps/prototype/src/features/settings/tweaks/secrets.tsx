'use client'

import { type Control, usePrototype } from '../../../proto/use-prototype'
import { optionOf } from '../../shared/option-of'
import { SECRETS_DIALOGS, SECRETS_DIALOG_CONTROL } from '../../shared/secrets/secrets-tweaks'
import { ESecretsDialog } from '../../shared/secrets/secrets-view'
import { BULK_ADD_SAMPLE, PERSONAL_SECRETS } from '../fixtures/settings-library'
import { SecretsPage } from '../pages/secrets'

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
      initial={data === 'empty' ? [] : PERSONAL_SECRETS}
      openDialog={openDialog}
      bulkText={openDialog === ESecretsDialog.BulkAdd ? BULK_ADD_SAMPLE : ''}
    />
  )
}
