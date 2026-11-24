import {
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  Icon,
  Rule,
  Text,
  useTheme,
  withAlpha,
} from '@dltech/atlas-ui-native'
import { radius, space } from '@dltech/atlas-ui/tokens'
import { ChevronRight, Plus } from 'lucide-react-native'
import { Pressable, StyleSheet, View } from 'react-native'

import { ESectionKind, type ISessionSection } from './session-sections'

const Chevron = ({ open, color, size }: { open: boolean; color: string; size: number }) => (
  <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
    <Icon icon={ChevronRight} color={color} size={size} />
  </View>
)

const Count = ({ value }: { value: number }) => (
  <Text size={ETextRole.Xs} family={EFontFamily.Mono} tone={ETextTone.Muted}>
    {value}
  </Text>
)

const BucketHeader = ({
  section,
  onToggle,
}: {
  section: ISessionSection
  onToggle: () => void
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: section.expanded }}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.header,
        pressed ? { backgroundColor: theme.sidebarAccent } : null,
      ]}
    >
      <Chevron open={section.expanded} color={theme.mutedForeground} size={16} />
      <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
        {section.title}
      </Text>
      {section.hint !== null ? (
        <Text size={ETextRole.Xs} color={withAlpha({ color: theme.mutedForeground, alpha: 0.7 })}>
          {section.hint}
        </Text>
      ) : null}
      <Rule />
      <Count value={section.count} />
    </Pressable>
  )
}

const ProjectHeader = ({
  section,
  onToggle,
  onNewSession,
}: {
  section: ISessionSection
  onToggle: () => void
  onNewSession: (projectId: string) => void
}) => {
  const theme = useTheme()
  const projectId = section.projectId
  return (
    <View style={styles.projectHeader}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: section.expanded }}
        onPress={onToggle}
        style={styles.name}
      >
        <Text
          size={ETextRole.Xs}
          weight={EFontWeight.Semibold}
          tone={ETextTone.Muted}
          numberOfLines={1}
          style={styles.label}
        >
          {section.title}
        </Text>
      </Pressable>
      {projectId === null ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`New session in ${section.title}`}
          onPress={() => onNewSession(projectId)}
          style={({ pressed }) => [
            styles.add,
            pressed ? { backgroundColor: theme.sidebarAccent } : null,
          ]}
        >
          <Icon icon={Plus} color={theme.mutedForeground} size={16} />
        </Pressable>
      )}
    </View>
  )
}

export const SectionHeader = ({
  section,
  onToggle,
  onNewSession,
}: {
  section: ISessionSection
  onToggle: (key: string) => void
  onNewSession: (projectId: string) => void
}) => {
  const handleToggle = () => onToggle(section.key)
  const header =
    section.kind !== ESectionKind.Project ? (
      <BucketHeader section={section} onToggle={handleToggle} />
    ) : (
      <ProjectHeader section={section} onToggle={handleToggle} onNewSession={onNewSession} />
    )
  return <View style={{ marginTop: section.gapBefore }}>{header}</View>
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    flexDirection: 'row',
    gap: space(1.5),
    height: 28,
    marginBottom: space(0.5),
    paddingHorizontal: space(2),
  },
  projectHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: space(0.5),
    paddingLeft: space(2),
    paddingRight: space(1),
  },
  name: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    flex: 1,
  },
  label: {
    flexShrink: 1,
    letterSpacing: 0.4,
  },
  add: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
})
