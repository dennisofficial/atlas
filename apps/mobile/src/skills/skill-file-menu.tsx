import { Button, EButtonVariant, EButtonSize, Icon, useTheme } from '@dltech/atlas-ui-native'
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Ellipsis } from 'lucide-react-native'
import {
  SKILL_FILE_ACTION_LABELS,
  skillFileActions,
  type SkillFileMenuProps,
} from './skill-file-actions'

export const SkillFileMenu = ({ folder, path, onAction }: SkillFileMenuProps) => {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Actions for ${path}`}
        onPress={() => setOpen(!open)}
        style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon icon={Ellipsis} size={18} color={theme.foreground} />
      </Pressable>
      {open
        ? skillFileActions(folder).map((action) => (
            <Button
              key={action}
              label={SKILL_FILE_ACTION_LABELS[action]}
              size={EButtonSize.Sm}
              variant={EButtonVariant.Ghost}
              onPress={() => {
                setOpen(false)
                onAction(action)
              }}
            />
          ))
        : null}
    </View>
  )
}
