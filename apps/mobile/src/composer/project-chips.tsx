import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'

import { useTheme } from '../theme/use-theme'

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
        return (
          <Pressable
            key={project.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onSelect(project.id)}
            style={[
              styles.chip,
              {
                borderColor: selected ? theme.primary : theme.border,
                backgroundColor: selected ? theme.accent : 'transparent',
              },
            ]}
          >
            <Text style={{ color: selected ? theme.foreground : theme.mutedForeground }}>
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
    gap: 8,
    paddingHorizontal: 2,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
})
