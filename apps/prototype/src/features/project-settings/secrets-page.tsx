import { ESecretsScope, type LibrarySecret } from '../settings/fixtures/settings-library'
import { PROJECT_SECRET_ROWS } from './fixtures/project-settings'
import { ESecretsDialog, SecretsView } from '../shared/secrets/secrets-view'

export function SecretsPage({
  initialRows = PROJECT_SECRET_ROWS,
  openDialog = ESecretsDialog.None,
  bulkText = '',
}: {
  initialRows?: LibrarySecret[]
  openDialog?: ESecretsDialog
  bulkText?: string
}) {
  return (
    <SecretsView
      scope={ESecretsScope.Project}
      initialRows={initialRows}
      description="Injected into every thread in this project. Overrides your personal values."
      openDialog={openDialog}
      bulkText={bulkText}
    />
  )
}
