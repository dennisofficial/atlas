import { projectSkillTarget } from '@dltech/atlas-client/settings'
import { useLocalSearchParams } from 'expo-router'

import { SkillsScreen } from '../../../../skills/skills-screen'

export default function ProjectSkillsScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  return <SkillsScreen target={projectSkillTarget({ projectId })} />
}
