import {
  ESecretsScope,
  PERSONAL_SECRETS,
  type LibrarySecret,
} from '../../../fixtures/settings-library'
import { ESecretsDialog, SecretsView } from '../../shared/secrets/secrets-view'

export function SecretsPage({
  initial = PERSONAL_SECRETS,
  openDialog = ESecretsDialog.None,
  bulkText = '',
}: {
  initial?: LibrarySecret[]
  openDialog?: ESecretsDialog
  bulkText?: string
}) {
  return (
    <SecretsView
      scope={ESecretsScope.Personal}
      initialRows={initial}
      description="Injected into every sandbox you start. Project values override yours."
      openDialog={openDialog}
      bulkText={bulkText}
    />
  )
}
