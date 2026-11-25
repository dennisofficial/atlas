import { AccessGrantsList } from '../../shared/access/access-grants-list'
import { PERSONAL_GRANTS } from '../../shared/access/fixtures'
import { SettingsPage } from '../settings-layout'

const TITLE = 'Access'

const DESCRIPTION =
  'Secrets and files for every project. A project value with the same name or path wins.'

export function AccessPage() {
  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      <AccessGrantsList grants={PERSONAL_GRANTS} />
    </SettingsPage>
  )
}
