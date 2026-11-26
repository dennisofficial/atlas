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
import {
  ChevronRight,
  FolderGit2,
  FolderX,
  type LucideIcon,
  Settings,
  SquarePen,
} from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'

import {
  EProjectHeaderAction,
  projectChevronLabelOf,
  projectHeaderActionsOf,
} from './project-header-actions'
import { ESectionKind, type ISessionSection } from './session-sections'

const ICON_BUTTON_HIT_SLOP = space(2.5)

const ACTION_ICONS: Record<EProjectHeaderAction, LucideIcon> = {
  [EProjectHeaderAction.Settings]: Settings,
  [EProjectHeaderAction.NewSession]: SquarePen,
}

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

const RowButton = ({
  label,
  expanded,
  onPress,
  children,
}: {
  label: string
  expanded?: boolean
  onPress: () => void
  children: ReactNode
}) => {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      hitSlop={ICON_BUTTON_HIT_SLOP}
      onPress={onPress}
      style={({ pressed }) => [
        styles.rowButton,
        pressed ? { backgroundColor: theme.sidebarAccent } : null,
      ]}
    >
      {children}
    </Pressable>
  )
}

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
  onOpenSettings,
}: {
  section: ISessionSection
  onToggle: () => void
  onNewSession: (projectId: string) => void
  onOpenSettings: (projectId: string) => void
}) => {
  const theme = useTheme()
  const projectId = section.projectId
  const actions = projectHeaderActionsOf({ projectId, title: section.title })

  const handleAction = (action: EProjectHeaderAction) => {
    if (projectId === null) return
    if (action === EProjectHeaderAction.Settings) onOpenSettings(projectId)
    else onNewSession(projectId)
  }

  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: section.expanded }}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.name,
          pressed ? { backgroundColor: theme.sidebarAccent } : null,
        ]}
      >
        <Icon
          icon={projectId === null ? FolderX : FolderGit2}
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
      {actions.map(({ action, label }) => (
        <RowButton key={action} label={label} onPress={() => handleAction(action)}>
          <Icon icon={ACTION_ICONS[action]} color={theme.mutedForeground} size={16} />
        </RowButton>
      ))}
      <Count value={section.count} />
      <RowButton
        label={projectChevronLabelOf({ expanded: section.expanded })}
        expanded={section.expanded}
        onPress={onToggle}
      >
        <Chevron open={section.expanded} color={theme.mutedForeground} size={14} />
      </RowButton>
    </View>
  )
}

export const SectionHeader = ({
  section,
  onToggle,
  onNewSession,
  onOpenSettings,
}: {
  section: ISessionSection
  onToggle: (key: string) => void
  onNewSession: (projectId: string) => void
  onOpenSettings: (projectId: string) => void
}) => {
  const handleToggle = () => onToggle(section.key)
  const header =
    section.kind !== ESectionKind.Project ? (
      <BucketHeader section={section} onToggle={handleToggle} />
    ) : (
      <ProjectHeader
        section={section}
        onToggle={handleToggle}
        onNewSession={onNewSession}
        onOpenSettings={onOpenSettings}
      />
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
    borderRadius: radius(0.8),
    flexDirection: 'row',
    flexShrink: 1,
    gap: space(1.5),
    height: 24,
  },
  label: {
    flexShrink: 1,
  },
  rowButton: {
    alignItems: 'center',
    borderRadius: radius(0.8),
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
})
