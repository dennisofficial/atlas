import { EAccessScope } from '@dltech/atlas-client/settings'
import { useLocalSearchParams } from 'expo-router'
import { AccessScreen } from '../../../../settings/access/access-screen'

export default function GroupAccessScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>()
  return <AccessScreen scope={{ kind: EAccessScope.Group, groupId }} />
}
