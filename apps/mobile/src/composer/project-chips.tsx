import { EFontFamily, ETextRole, ETextTone, Icon, Text, useTheme } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { FolderGit2 } from 'lucide-react-native'
import { Pressable, ScrollView, StyleSheet } from 'react-native'

export interface IProjectOption {
  id: string
  name: string
}

export const ProjectChips = ({
  projects,
  selectedId,
  onSelect,
}: {
  projects: readonly IProjectOption[]
  selectedId: string | null
  onSelect: (id: string) => void
}) => {
  const theme = useTheme()
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {projects.map((project) => {
        const selected = project.id === selectedId
        const color = selected ? theme.foreground : theme.mutedForeground
        return (
          <Pressable
            key={project.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(project.id)}
            style={[styles.chip, selected ? { backgroundColor: theme.muted } : null]}
          >
            <Icon icon={FolderGit2} color={color} size={14} />
            <Text
              size={ETextRole.Sm}
              family={EFontFamily.Sans}
              tone={selected ? ETextTone.Foreground : ETextTone.Muted}
            >
              {project.name}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: {
    gap: space(1),
  },
  chip: {
    alignItems: 'center',
    borderRadius: radius(1),
    flexDirection: 'row',
    gap: space(1.5),
    height: 28,
    paddingHorizontal: space(2),
  },
})
