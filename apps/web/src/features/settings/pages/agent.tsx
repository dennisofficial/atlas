'use client'

import { RoutineTimezoneField } from '@/features/routines/routine-timezone-field'
import { deviceTimezone } from '@/features/routines/routine-timezones'
import type { SettingValues } from '@/lib/cloud-settings'

import { agentSettingsChanges, agentSettingsFrom } from '../data/personal/agent-settings'
import { fieldChanges, fieldValuesFrom } from '../data/personal/setting-fields'
import { QueryPage } from '../data/personal/query-boundary'
import { routineSettingsChanges, routineSettingsFrom } from '../data/personal/routine-settings'
import { AgentSkeleton } from '../skeletons/agent-skeletons'
import { useCloudSettings } from '@/lib/cloud-settings'
import { useSettingsDraft } from '../data/personal/use-settings-draft'
import { IMAGE_MODEL_ITEMS } from '../fixtures/settings-images'
import { CONTEXT_FIELDS } from '../fixtures/settings-fields'
import { SettingFieldRows } from '../parts/setting-fields'
import { ConfigFooter } from '../parts/agent-config-footer'
import { ChoiceSelect } from '../parts/agent-choice-select'
import { SettingsCard, SettingsPage, SettingsRow, SettingsSection } from '../settings-layout'

const TITLE = 'Agent'
const DESCRIPTION =
  'How the agent reads context, compacts and works. Every sandbox loads these when it starts.'
const TIMEZONE_INPUT_ID = 'agent-routine-timezone'

export function AgentPage() {
  const settings = useCloudSettings()
  return (
    <QueryPage
      query={settings.query}
      title={TITLE}
      description={DESCRIPTION}
      skeleton={<AgentSkeleton />}
    >
      {(values) => <AgentEditor values={values} save={settings.save} />}
    </QueryPage>
  )
}

function AgentEditor({
  values,
  save,
}: {
  values: SettingValues
  save: (changes: Record<string, string | number | boolean | null>) => Promise<void>
}) {
  const { draft, saving, handleSave } = useSettingsDraft({
    values,
    fromValues: agentSettingsFrom,
    toChanges: agentSettingsChanges,
    save,
  })
  const fieldsDraft = useSettingsDraft({
    values,
    fromValues: (all) => fieldValuesFrom({ fields: CONTEXT_FIELDS, values: all }),
    toChanges: fieldChanges,
    save,
  })
  const routineDraft = useSettingsDraft({
    values,
    fromValues: routineSettingsFrom,
    toChanges: routineSettingsChanges,
    save,
  })
  const { value, setValue } = draft
  const routine = routineDraft.draft
  const agentDirty = draft.dirty
  const fieldsDirty = fieldsDraft.draft.dirty
  const routineDirty =
    Object.keys(
      routineSettingsChanges({ saved: routineSettingsFrom(values), draft: routine.value }),
    ).length > 0
  const dirty =
    (agentDirty || fieldsDirty || routineDirty) &&
    !saving &&
    !fieldsDraft.saving &&
    !routineDraft.saving
  const handleSaveAll = async () => {
    if (agentDirty) await handleSave()
    if (fieldsDirty) await fieldsDraft.handleSave()
    if (routineDirty) await routineDraft.handleSave()
  }
  const handleDiscardAll = () => {
    draft.discard()
    fieldsDraft.draft.discard()
    routine.discard()
  }

  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      <SettingsSection
        title="Images"
        description="Which model the agent asks when it generates or edits a picture."
      >
        <SettingsCard>
          <SettingsRow
            title="Image model"
            description="The model image_generate uses when the agent names none. Only models that support Zero Data Retention are listed."
            control={
              <ChoiceSelect
                label="Image model"
                items={IMAGE_MODEL_ITEMS}
                value={value.imageModel}
                onChange={(imageModel) => setValue({ ...value, imageModel })}
              />
            }
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title="Context and skills"
        description="What the agent reads before each turn, when it compacts, and where it works."
      >
        <SettingsCard>
          <SettingFieldRows
            fields={CONTEXT_FIELDS}
            value={fieldsDraft.draft.value}
            onChange={fieldsDraft.draft.setValue}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title="Routines"
        description="What a new routine starts with, whether you create it here or ask the agent to."
      >
        <SettingsCard>
          <SettingsRow
            title={<label htmlFor={TIMEZONE_INPUT_ID}>Default timezone</label>}
            description="New routines open in this zone. A run keeps its wall-clock time in the routine's own zone, so travelling does not move it. Empty means this device's zone."
            control={
              <div className="w-72">
                <RoutineTimezoneField
                  id={TIMEZONE_INPUT_ID}
                  value={routine.value.timezone}
                  placeholder={deviceTimezone()}
                  onChange={(timezone) => routine.setValue({ ...routine.value, timezone })}
                />
              </div>
            }
          />
        </SettingsCard>
      </SettingsSection>
      <ConfigFooter
        dirty={dirty}
        canSave={dirty}
        onDiscard={handleDiscardAll}
        onSave={() => void handleSaveAll()}
      />
    </SettingsPage>
  )
}
