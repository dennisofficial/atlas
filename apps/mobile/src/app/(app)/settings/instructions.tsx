import { INSTRUCTIONS_CHAR_LIMIT, INSTRUCTIONS_DESCRIPTION } from '@dltech/atlas-client/settings'
import { ETextRole, ETextTone, Text } from '@dltech/atlas-ui-native'

import { useAuth } from '../../../auth/auth-provider'
import { InstructionsEditor } from '../../../settings/instructions-editor'
import {
  loadPersonalInstructions,
  savePersonalInstructions,
} from '../../../settings/instructions-api'
import { SettingsScroll } from '../../../settings/settings-scroll'
import { StatusRows } from '../../../settings/settings-parts'
import { useApiResource } from '../../../settings/use-api-resource'

export default function PersonalInstructionsScreen() {
  const { api } = useAuth()
  const { state, data, reload } = useApiResource({
    load: () => (api === undefined ? Promise.resolve(null) : loadPersonalInstructions({ api })),
    deps: [api],
  })

  const handleSave = ({ text, baseRevision }: { text: string; baseRevision: number }) => {
    if (api === undefined) return Promise.reject(new Error('The account is not signed in.'))
    return savePersonalInstructions({ api, text, baseRevision })
  }

  return (
    <SettingsScroll>
      <StatusRows
        state={state}
        onRetry={reload}
        failure="These instructions could not be loaded."
      />
      {data === null ? null : (
        <>
          <Text size={ETextRole.Sm} tone={ETextTone.Muted}>
            {INSTRUCTIONS_DESCRIPTION}
          </Text>
          <InstructionsEditor doc={data} limit={INSTRUCTIONS_CHAR_LIMIT} onSave={handleSave} />
        </>
      )}
    </SettingsScroll>
  )
}
