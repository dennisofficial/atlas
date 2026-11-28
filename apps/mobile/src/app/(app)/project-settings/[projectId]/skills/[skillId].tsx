import { projectSkillTarget } from '@dltech/atlas-client/settings'
import { useLocalSearchParams } from 'expo-router'
import { SkillDetailScreen } from '../../../../../skills/skill-detail-screen'

export default function ProjectSkillDetailScreen() {
  const { projectId, skillId } = useLocalSearchParams<{ projectId: string; skillId: string }>()
  return <SkillDetailScreen target={{ ...projectSkillTarget({ projectId }), skill: skillId }} />
}
