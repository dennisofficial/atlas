import { groupSkillTarget } from '@dltech/atlas-client/settings'
import { useLocalSearchParams } from 'expo-router'

import { NewSkillForm } from '../../../../skills/new-skill-form'

export default function NewGroupSkillScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>()
  return <NewSkillForm target={groupSkillTarget({ groupId })} />
}
