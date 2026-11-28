import { EAccessScope } from '@dltech/atlas-client/settings'
import { AccessScreen } from '../../../settings/access/access-screen'

export default function PersonalAccessScreen() {
  return <AccessScreen scope={{ kind: EAccessScope.Personal }} />
}
