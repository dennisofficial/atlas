import { SettingsSection } from '../settings/settings-layout'
import { AccessGrantsList } from '../shared/access/access-grants-list'
import { PROJECT_GRANTS } from '../shared/access/fixtures'

const DESCRIPTION =
  'Tell the agent what each secret and file gives it access to. Atlas sends this to every session.'

export function AccessPage() {
  return (
    <SettingsSection title="Access" description={DESCRIPTION}>
      <AccessGrantsList grants={PROJECT_GRANTS} />
    </SettingsSection>
  )
}
