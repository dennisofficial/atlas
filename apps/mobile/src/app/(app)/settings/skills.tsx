import { personalSkillTarget } from '@dltech/atlas-client/settings'

import { SkillsScreen } from '../../../skills/skills-screen'

export default function PersonalSkillsScreen() {
  return <SkillsScreen target={personalSkillTarget} />
}
