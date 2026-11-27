import { inheritedTitleOf, overriddenLabelOf } from '@dltech/atlas-client/settings'
import { CardRow, EFontFamily, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import type { EConfigLayer } from '@dltech/atlas-core'
import type { SkillLayer } from '@dltech/atlas-wire/web'
import { router } from 'expo-router'
import { StyleSheet, View } from 'react-native'

import { layerSkillsRouteOf } from './skill-routes'
import { NavRow, Section } from '../settings/settings-parts'

const INHERITED_DESCRIPTION = 'Inherited unless a higher layer sets the same thing.'

export const InheritedSkills = ({
  layers,
  ownLayer,
}: {
  layers: readonly SkillLayer[]
  ownLayer: EConfigLayer
}) => {
  const visible = layers.filter((entry) => entry.layer !== ownLayer && entry.items.length > 0)
  if (visible.length === 0) return null

  return (
    <>
      <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
        {INHERITED_DESCRIPTION}
      </Text>
      {visible.map((entry) => {
        const href = layerSkillsRouteOf({ layer: entry.layer, owner: entry.owner })
        return (
          <Section key={entry.layer} title={inheritedTitleOf(entry)}>
            {entry.items.map((item) => (
              <CardRow key={item.name}>
                <View style={styles.body}>
                  <Text size={ETextRole.Sm} family={EFontFamily.Mono} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.description === '' ? null : (
                    <Text size={ETextRole.Xs} tone={ETextTone.Muted} numberOfLines={1}>
                      {item.description}
                    </Text>
                  )}
                </View>
                {item.overriddenBy === null ? null : (
                  <Text size={ETextRole.Xs} tone={ETextTone.Muted}>
                    {overriddenLabelOf(item.overriddenBy)}
                  </Text>
                )}
              </CardRow>
            ))}
            {href === null ? null : (
              <NavRow label="Edit these skills" onPress={() => router.push(href)} />
            )}
          </Section>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create({
  body: {
    flexShrink: 1,
    gap: space(0.5),
  },
})
