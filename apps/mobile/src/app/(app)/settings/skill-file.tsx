import { useLocalSearchParams } from 'expo-router'
import { ETextRole, Text } from '@dltech/atlas-ui-native'
import { SkillFileForm } from '../../../skills/skill-file-form'
import {
  skillFileFormInputOf,
  type SkillFileFormParams,
} from '../../../skills/skill-file-form-input'
import { SettingsScroll } from '../../../settings/settings-scroll'

export default function SkillFileFormScreen() {
  const params = useLocalSearchParams<SkillFileFormParams>()
  const input = skillFileFormInputOf(params)
  if (!input)
    return (
      <SettingsScroll>
        <Text size={ETextRole.Sm}>Invalid skill file action.</Text>
      </SettingsScroll>
    )
  return <SkillFileForm input={input} />
}
