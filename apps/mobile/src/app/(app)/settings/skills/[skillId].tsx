import { personalSkillTarget } from '@dltech/atlas-client/settings'
import { useLocalSearchParams } from 'expo-router'
import { SkillDetailScreen } from '../../../../skills/skill-detail-screen'

export default function PersonalSkillDetailScreen() {
  const { skillId } = useLocalSearchParams<{ skillId: string }>()
  return <SkillDetailScreen target={{ ...personalSkillTarget, skill: skillId }} />
}
