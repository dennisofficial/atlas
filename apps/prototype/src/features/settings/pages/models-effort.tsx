import { useEffect, useState } from 'react'

import {
  ACCESS_ALL,
  DEFAULT_MODELS_CONFIG,
  DEFAULT_PINNED,
  EDITED_MODELS_CONFIG,
  ROLE_ORDER,
  type EAgentRole,
  type ModelsConfig,
  type ProviderAccessMap,
} from '@dltech/atlas-ui/fixtures/settings-models'
import { ConfigFooter } from '../parts/agent-config-footer'
import { ModelCatalogue } from '../parts/model-catalogue'
import { ModelsEmpty } from '../parts/model-empty'
import { RoleRow } from '../parts/model-role-row'
import { hasAnyRoute } from '../parts/model-routes'
import { catalogueOptions } from '../parts/model-state'
import { SettingsCard, SettingsPage, SettingsSection } from '../settings-layout'
import { useDraft } from '../use-draft'

const DESCRIPTION = 'Pick the model and how hard it thinks for each part of the agent.'

export function ModelsEffortPage({
  startEdited = false,
  initialConfig = DEFAULT_MODELS_CONFIG,
  access = ACCESS_ALL,
  openRole,
  initialQuery,
}: {
  startEdited?: boolean
  initialConfig?: ModelsConfig
  access?: ProviderAccessMap
  openRole?: EAgentRole
  initialQuery?: string
}) {
  const draft = useDraft<ModelsConfig>(initialConfig)
  const { setValue } = draft
  const [pinned, setPinned] = useState(DEFAULT_PINNED)

  useEffect(() => {
    if (startEdited) setValue(EDITED_MODELS_CONFIG)
  }, [startEdited, setValue])

  if (!hasAnyRoute(access)) {
    return (
      <SettingsPage title="Models & Effort" description={DESCRIPTION}>
        <ModelsEmpty />
      </SettingsPage>
    )
  }

  const options = catalogueOptions(access)

  return (
    <SettingsPage title="Models & Effort" description={DESCRIPTION}>
      <SettingsSection title="Roles">
        <SettingsCard>
          {ROLE_ORDER.map((role) => (
            <RoleRow
              key={role}
              role={role}
              config={draft.value}
              access={access}
              options={options}
              pinned={pinned}
              defaultOpen={role === openRole}
              onConfigChange={setValue}
              onPinnedChange={setPinned}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
      <ModelCatalogue
        config={draft.value}
        access={access}
        pinned={pinned}
        onPinnedChange={setPinned}
        initialQuery={initialQuery}
      />
      <ConfigFooter dirty={draft.dirty} onDiscard={draft.discard} onSave={draft.save} />
    </SettingsPage>
  )
}
