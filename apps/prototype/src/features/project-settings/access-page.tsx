import { SettingsSection } from '../settings/settings-layout'
import {
  InheritedLayersPreview,
  GROUP_LAYER,
  PERSONAL_LAYER,
} from '../groups/inherited-layers-preview'
import { AccessGrantsList } from '../shared/access/access-grants-list'
import { PROJECT_GRANTS } from '../shared/access/fixtures'

const DESCRIPTION =
  'Tell the agent what each secret and file gives it access to. Atlas sends this to every session.'

export function AccessPage() {
  return (
    <>
      <InheritedLayersPreview layers={[PERSONAL_LAYER, GROUP_LAYER]} />
      <SettingsSection title="Access" description={DESCRIPTION}>
        <AccessGrantsList grants={PROJECT_GRANTS} />
      </SettingsSection>
    </>
  )
}
