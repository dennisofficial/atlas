import { EAccessScope } from '@dltech/atlas-client/settings'
import { useLocalSearchParams } from 'expo-router'
import { AccessScreen } from '../../../../settings/access/access-screen'

export default function ProjectAccessScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  return <AccessScreen scope={{ kind: EAccessScope.Project, projectId }} />
}
