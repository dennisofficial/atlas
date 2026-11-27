import { groupSkillTarget } from '@dltech/atlas-client/settings'
import { useLocalSearchParams } from 'expo-router'

import { SkillsScreen } from '../../../../skills/skills-screen'

export default function GroupSkillsScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>()
  return <SkillsScreen target={groupSkillTarget({ groupId })} />
}
