import {
  EFontFamily,
  EFontWeight,
  ETextRole,
  ETextTone,
  Icon,
  Text,
  useTheme,
} from '@dltech/atlas-ui-native'
import { skillIsSelectable } from '@dltech/atlas-client/settings'
import { radius, space } from '@dltech/atlas-ui/tokens'
import type { SkillSummary } from '@dltech/atlas-wire/web'
import { Check } from 'lucide-react-native'
import { Pressable, StyleSheet, View } from 'react-native'

import { skillDescriptionLabelOf, skillMetaLineOf } from './skills-list-state'

const Pill = ({ label }: { label: string }) => {
  const theme = useTheme()
  return (
    <View style={[styles.pill, { borderColor: theme.border }]}>
      <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
        {label}
      </Text>
    </View>
  )
}

const SelectionMark = ({ checked }: { checked: boolean }) => {
  const theme = useTheme()
  return (
    <View
      style={[
        styles.mark,
        {
          borderColor: checked ? theme.primary : theme.border,
          backgroundColor: checked ? theme.primary : 'transparent',
        },
      ]}
    >
      {checked ? <Icon icon={Check} color={theme.primaryForeground} size={12} /> : null}
    </View>
  )
}

export const SkillRow = ({
  skill,
  selecting,
  selected,
  onSelect,
  onOpen,
}: {
  skill: SkillSummary
  selecting: boolean
  selected: boolean
  onSelect: () => void
  onOpen: () => void
}) => {
  const theme = useTheme()
  const builtIn = !skillIsSelectable(skill)
  const interactive = !selecting || !builtIn

  return (
    <Pressable
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityLabel={skill.name}
      accessibilityState={{ checked: selected, disabled: !interactive }}
      disabled={!interactive}
      onPress={selecting ? onSelect : onOpen}
    >
      <View style={[styles.row, selecting && builtIn ? styles.unselectable : null]}>
        {selecting ? (
          builtIn ? (
            <View style={styles.markGap} />
          ) : (
            <SelectionMark checked={selected} />
          )
        ) : null}
        <View style={styles.body}>
          <View style={styles.titleLine}>
            <Text
              size={ETextRole.Sm}
              family={EFontFamily.Mono}
              weight={EFontWeight.Medium}
              numberOfLines={1}
              style={[styles.name, { color: theme.foreground }]}
            >
              {skill.name}
            </Text>
            {builtIn ? <Pill label="Built-in" /> : null}
            {skill.overridesBuiltIn ? <Pill label="Overrides built-in" /> : null}
          </View>
          <Text size={ETextRole.Xs} tone={ETextTone.Muted} numberOfLines={2}>
            {skillDescriptionLabelOf(skill)}
          </Text>
          <Text size={ETextRole.Xs} tone={ETextTone.Muted} style={styles.meta}>
            {skillMetaLineOf({ skill, now: Date.now() })}
          </Text>
        </View>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: space(3),
    paddingHorizontal: space(4),
    paddingVertical: space(3),
  },
  unselectable: {
    opacity: 0.55,
  },
  body: {
    flexShrink: 1,
    gap: space(1),
  },
  titleLine: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space(1.5),
  },
  name: {
    flexShrink: 1,
  },
  meta: {
    fontVariant: ['tabular-nums'],
  },
  mark: {
    alignItems: 'center',
    borderRadius: radius(0.5),
    borderWidth: 1.5,
    height: 20,
    justifyContent: 'center',
    marginTop: space(0.5),
    width: 20,
  },
  markGap: {
    width: 20,
  },
  pill: {
    borderRadius: radius(0.5),
    borderWidth: 1,
    paddingHorizontal: space(1.5),
    paddingVertical: space(0.5),
  },
})
