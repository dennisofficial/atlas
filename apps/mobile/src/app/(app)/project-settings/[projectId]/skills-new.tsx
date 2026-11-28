import { projectSkillTarget } from '@dltech/atlas-client/settings'
import { useLocalSearchParams } from 'expo-router'

import { NewSkillForm } from '../../../../skills/new-skill-form'

export default function NewProjectSkillScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  return <NewSkillForm target={projectSkillTarget({ projectId })} />
}
