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
import { ChevronRight, FolderGit2, FolderX, SquarePen } from 'lucide-react-native'
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
  const handleToggle = () => onToggle(section.key)
  const header =
    section.kind !== ESectionKind.Project ? (
      <BucketHeader section={section} onToggle={handleToggle} />
    ) : (
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: section.expanded }}
          onPress={handleToggle}
          style={styles.name}
        >
          <Icon
            icon={section.projectId === null ? FolderX : FolderGit2}
            color={theme.mutedForeground}
            size={16}
          />
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
        {section.projectId !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`New session in ${section.title}`}
            hitSlop={8}
            onPress={() => section.projectId !== null && onNewSession(section.projectId)}
            style={styles.action}
          >
            <Icon icon={SquarePen} color={theme.mutedForeground} size={12} />
          </Pressable>
        ) : null}
        <Count value={section.count} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={section.expanded ? 'Collapse project' : 'Expand project'}
          hitSlop={8}
          onPress={handleToggle}
          style={styles.action}
        >
          <Chevron open={section.expanded} color={theme.mutedForeground} size={14} />
        </Pressable>
      </View>
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
