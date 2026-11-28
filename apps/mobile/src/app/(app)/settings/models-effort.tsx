import {
  ROLE_GROUPS,
  choiceOf,
  modelsDraftFrom,
  ownsModel,
  resolveRoles,
  roleTitleOf,
  staleOwnerOf,
} from '@dltech/atlas-client/settings'
import { CardRow, ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'
import { space } from '@dltech/atlas-ui/tokens'
import { roleKey } from '@dltech/atlas-core'
import { router } from 'expo-router'
import { StyleSheet } from 'react-native'

import { useModels } from '../../../composer/use-models'
import { EResourceState } from '../../../settings/api-resource-state'
import { ModelRoleRow } from '../../../settings/model-role-row'
import { Section, StatusRows } from '../../../settings/settings-parts'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { useSettings } from '../../../settings/settings-provider'

export default function ModelsEffortScreen() {
  const settings = useSettings()
  const { models, ready, failed } = useModels()
  const draft = modelsDraftFrom(settings.values)
  const choices = resolveRoles({ draft, models })
  const owner = staleOwnerOf(choices)

  if (failed && models.length === 0) {
    return (
      <SettingsScroll>
        <Section>
          <StatusRows state={EResourceState.Failed} />
        </Section>
      </SettingsScroll>
    )
  }
  if (!ready) {
    return (
      <SettingsScroll>
        <Section>
          <StatusRows state={EResourceState.Loading} />
        </Section>
      </SettingsScroll>
    )
  }
  if (models.length === 0) {
    return (
      <SettingsScroll>
        <Section title="Models">
          <CardRow>
            <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
              No provider is connected yet. Add one in Settings, then pick a model for each role
              here.
            </Text>
          </CardRow>
        </Section>
      </SettingsScroll>
    )
  }

  return (
    <SettingsScroll>
      {owner === undefined ? null : (
        <Section title="Attention">
          <CardRow>
            <Text size={ETextRole.Sm} tone={ETextTone.Destructive} style={styles.alert}>
              {`${roleTitleOf(owner.role)} is set to a model this account cannot reach. Everything that follows it is affected too.`}
            </Text>
          </CardRow>
        </Section>
      )}
      {ROLE_GROUPS.map((group) => (
        <Section key={group.title} title={group.title}>
          {group.roles.map((role) => (
            <ModelRoleRow
              key={roleTitleOf(role)}
              role={role}
              choice={choiceOf({ choices, role })}
              models={models}
              following={!ownsModel(choiceOf({ choices, role }))}
              onPress={() =>
                router.push({ pathname: '/settings/model-role', params: { role: roleKey(role) } })
              }
            />
          ))}
        </Section>
      ))}
    </SettingsScroll>
  )
}

const styles = StyleSheet.create({
  alert: {
    flexShrink: 1,
    gap: space(1),
  },
})
