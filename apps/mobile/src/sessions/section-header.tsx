import {
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  Icon,
  Rule,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { ChevronRight, FolderGit2, SquarePen } from 'lucide-react-native'
import { Pressable, StyleSheet, View } from 'react-native'

import { ESectionKind, type ISessionSection } from './session-sections'

const Chevron = ({ open, color, size }: { open: boolean; color: string; size: number }) => (
  <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
    <Icon icon={ChevronRight} color={color} size={size} />
  </View>
)

export const SectionHeader = ({
  section,
  onToggle,
  onNewSession,
}: {
  section: ISessionSection
  onToggle: (key: string) => void
  onNewSession: (projectId: string) => void
}) => {
  const theme = useTheme()
  const count = (
    <Text size={ETextRole.Xs} family={EFontFamily.Mono} tone={ETextTone.Muted}>
      {section.count}
    </Text>
  )
  if (section.kind !== ESectionKind.Project || section.projectId === null) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: section.expanded }}
        onPress={() => onToggle(section.key)}
        style={({ pressed }) => [
          styles.header,
          pressed ? { backgroundColor: theme.sidebarAccent } : null,
        ]}
      >
        <Chevron open={section.expanded} color={theme.mutedForeground} size={16} />
        <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
          {section.title}
        </Text>
        <Rule />
        {count}
      </Pressable>
    )
  }
  const projectId = section.projectId
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: section.expanded }}
        onPress={() => onToggle(section.key)}
        style={styles.name}
      >
        <Icon icon={FolderGit2} color={theme.mutedForeground} size={16} />
        <Text
          size={ETextRole.Sm}
          weight={EFontWeight.Medium}
          numberOfLines={1}
          style={styles.label}
        >
          {section.title}
        </Text>
      </Pressable>
      <Rule />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`New session in ${section.title}`}
        hitSlop={8}
        onPress={() => onNewSession(projectId)}
        style={styles.action}
      >
        <Icon icon={SquarePen} color={theme.mutedForeground} size={14} />
      </Pressable>
      {count}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={section.expanded ? 'Collapse project' : 'Expand project'}
        hitSlop={8}
        onPress={() => onToggle(section.key)}
        style={styles.action}
      >
        <Chevron open={section.expanded} color={theme.mutedForeground} size={14} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flexDirection: 'row',
    gap: space(1.5),
    height: 28,
    marginTop: space(2),
    paddingHorizontal: space(2),
  },
  name: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: space(1.5),
  },
  label: {
    flexShrink: 1,
  },
  action: {
    alignItems: 'center',
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
})
