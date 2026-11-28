import { useIsDark } from '@dltech/atlas-ui-native'
import { Button, Host, Menu } from '@expo/ui/swift-ui'
import { buttonStyle, labelStyle, menuIndicator } from '@expo/ui/swift-ui/modifiers'
import {
  SKILL_FILE_ACTION_LABELS,
  skillFileActions,
  type SkillFileMenuProps,
} from './skill-file-actions'

export const SkillFileMenu = ({ folder, path, onAction }: SkillFileMenuProps) => {
  const dark = useIsDark()
  return (
    <Host colorScheme={dark ? 'dark' : 'light'} matchContents alignment="trailing">
      <Menu
        label={`Actions for ${path}`}
        systemImage="ellipsis"
        modifiers={[buttonStyle('plain'), labelStyle('iconOnly'), menuIndicator('hidden')]}
      >
        {skillFileActions(folder).map((action) => (
          <Button
            key={action}
            label={SKILL_FILE_ACTION_LABELS[action]}
            onPress={() => onAction(action)}
          />
        ))}
      </Menu>
    </Host>
  )
}
