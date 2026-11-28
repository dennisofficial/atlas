import { groupSkillTarget } from '@dltech/atlas-client/settings'
import { useLocalSearchParams } from 'expo-router'
import { SkillDetailScreen } from '../../../../../skills/skill-detail-screen'

export default function GroupSkillDetailScreen() {
  const { groupId, skillId } = useLocalSearchParams<{ groupId: string; skillId: string }>()
  return <SkillDetailScreen target={{ ...groupSkillTarget({ groupId }), skill: skillId }} />
}
