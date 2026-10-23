import { ESecretsScope, type LibrarySecret } from '../../fixtures/settings-library'
import { PROJECT_SECRET_ROWS } from '../../fixtures/project-settings'
import { ESecretsDialog, SecretsView } from '../shared/secrets/secrets-view'

export function SecretsPage({
  initialRows = PROJECT_SECRET_ROWS,
  openDialog = ESecretsDialog.None,
  bulkText = '',
  onOpenPersonal,
}: {
  initialRows?: LibrarySecret[]
  openDialog?: ESecretsDialog
  bulkText?: string
  onOpenPersonal?: () => void
}) {
  return (
    <SecretsView
      scope={ESecretsScope.Project}
      initialRows={initialRows}
      description="Injected into every thread in this project. Overrides your personal values."
      openDialog={openDialog}
      bulkText={bulkText}
      onOpenPersonal={onOpenPersonal}
    />
  )
}
