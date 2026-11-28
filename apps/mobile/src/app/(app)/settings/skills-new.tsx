import { personalSkillTarget } from '@dltech/atlas-client/settings'

import { NewSkillForm } from '../../../skills/new-skill-form'

export default function NewPersonalSkillScreen() {
  return <NewSkillForm target={personalSkillTarget} />
}
