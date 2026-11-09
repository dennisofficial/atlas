import { ETextRole, ETextTone, Icon, Text, useTheme, withAlpha } from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { Check, ChevronDown, FolderGit2, FolderX } from 'lucide-react-native'
import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native'

import { type IProjectOption, projectLabelOf } from './project-options'

const ProjectRow = ({
  label,
  selected,
  onPress,
}: {
  label: string
  selected: boolean
  onPress: () => void
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.accent : 'transparent' },
      ]}
    >
      <Text size={ETextRole.Sm} numberOfLines={1} style={styles.rowLabel}>
        {label}
      </Text>
      {selected ? <Icon icon={Check} color={theme.foreground} size={16} /> : null}
    </Pressable>
  )
}

export const ProjectSelect = ({
  projects,
  projectId,
  onProjectChange,
}: {
  projects: readonly IProjectOption[]
  projectId: string | null
  onProjectChange: (id: string) => void
}) => {
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const label = projectLabelOf({ projects, projectId })
  const handleSelect = (id: string) => {
    onProjectChange(id)
    setOpen(false)
  }
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Project: ${label}`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, pressed ? { backgroundColor: theme.muted } : null]}
      >
        <Icon icon={projectId === null ? FolderX : FolderGit2} color={theme.foreground} size={16} />
        <Text size={ETextRole.Sm} numberOfLines={1} style={styles.value}>
          {label}
        </Text>
        <Icon icon={ChevronDown} color={theme.mutedForeground} size={16} />
      </Pressable>
      <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
        <View
          style={[
            styles.overlay,
            { backgroundColor: withAlpha({ color: '#000000', alpha: 0.35 }) },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the project menu"
            onPress={() => setOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.popover,
                borderColor: withAlpha({ color: theme.foreground, alpha: 0.1 }),
              },
            ]}
          >
            {projects.length === 0 ? (
              <Text size={ETextRole.Sm} tone={ETextTone.Muted} style={styles.empty}>
                No projects yet
              </Text>
            ) : (
              <ScrollView keyboardShouldPersistTaps="handled">
                {projects.map((project) => (
                  <ProjectRow
                    key={project.id}
                    label={project.name}
                    selected={project.id === projectId}
                    onPress={() => handleSelect(project.id)}
                  />
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  trigger: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flexDirection: 'row',
    gap: space(1.5),
    height: 28,
    maxWidth: 240,
    paddingLeft: space(2.5),
    paddingRight: space(2),
  },
  value: {
    flexShrink: 1,
  },
  overlay: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
    padding: space(3),
  },
  sheet: {
    borderRadius: radius(1.2),
    borderWidth: 1,
    elevation: 8,
    maxHeight: 360,
    maxWidth: 480,
    padding: space(1),
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    width: '100%',
  },
  row: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flexDirection: 'row',
    gap: space(2),
    paddingHorizontal: space(2),
    paddingVertical: space(2),
  },
  rowLabel: {
    flex: 1,
  },
  empty: {
    paddingHorizontal: space(2),
    paddingVertical: space(2),
  },
})
