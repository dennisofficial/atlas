'use client'

import { FieldError } from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'

import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'

import {
  agentSettingsChanges,
  agentSettingsFrom,
  isValidDecisionsUrl,
} from '../data/personal/agent-settings'
import { fieldChanges, fieldValuesFrom } from '../data/personal/setting-fields'
import { QueryPage } from '../data/personal/query-boundary'
import { useAgentKeys } from '../data/personal/use-agent-keys'
import { usePersonalSettings, useSettingsDraft } from '../data/personal/use-settings-draft'
import {
  CLASSIFIER_MODE_ITEMS,
  DECISIONS_PROVIDER_ITEMS,
  DEFAULT_DECISIONS_MODEL,
  EDecisionsProvider,
  SEARCH_BACKEND_ITEMS,
} from '../fixtures/settings-decisions'
import { CONTEXT_FIELDS } from '../fixtures/settings-fields'
import { SettingFieldRows } from '../parts/setting-fields'
import { ConfigFooter } from '../parts/agent-config-footer'
import { ChoiceSelect } from '../parts/agent-choice-select'
import { DecisionsKeyRow, SearchKeyRow } from '../parts/agent-key-row'
import { SettingsCard, SettingsPage, SettingsRow, SettingsSection } from '../settings-layout'

const TITLE = 'Agent'
const DESCRIPTION =
  'How the agent judges risky tool calls, searches the web, reads context and compacts. Every sandbox loads these when it starts.'
const ENDPOINT_INPUT_ID = 'agent-decisions-url'
const MODEL_INPUT_ID = 'agent-decisions-model'
const URL_ERROR = 'Enter an absolute http:// or https:// URL'

export function AgentPage() {
  const settings = usePersonalSettings()
  return (
    <QueryPage query={settings.query} title={TITLE} description={DESCRIPTION}>
      {(values) => <AgentEditor values={values} save={settings.save} />}
    </QueryPage>
  )
}

function AgentEditor({
  values,
  save,
}: {
  values: SettingValues
  save: (changes: SettingChanges) => Promise<void>
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
  const { savedNames, handleSaveKey } = useAgentKeys()
  const { value, setValue } = draft
  const custom = value.provider === EDecisionsProvider.Custom
  const urlValid = isValidDecisionsUrl(value.url)
  const pending = agentSettingsChanges({
    saved: agentSettingsFrom(values),
    draft: value,
  })
  const agentDirty = Object.keys(pending).length > 0
  const fieldsDirty = fieldsDraft.draft.dirty
  const dirty = (agentDirty || fieldsDirty) && !saving && !fieldsDraft.saving
  const canSave = dirty && (!custom || urlValid)
  const handleSaveAll = async () => {
    if (agentDirty) await handleSave()
    if (fieldsDirty) await fieldsDraft.handleSave()
  }
  const handleDiscardAll = () => {
    draft.discard()
    fieldsDraft.draft.discard()
  }

  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      <SettingsSection
        title="Decisions"
        description="Typed decisions answer the yes-or-no questions behind the tool-call judge, skill suggestion and code-quality review."
      >
        <SettingsCard>
          <SettingsRow
            title="Decision provider"
            description="A preset pins its own endpoint and model. Custom points at an endpoint you run that speaks the Jev /v1/systemone protocol."
            control={
              <ChoiceSelect
                label="Decision provider"
                items={DECISIONS_PROVIDER_ITEMS}
                value={value.provider}
                onChange={(provider) => setValue({ ...value, provider })}
              />
            }
          />
          {custom ? (
            <SettingsRow
              title={<label htmlFor={ENDPOINT_INPUT_ID}>Decision endpoint</label>}
              description="The origin of the server, with or without the /v1/systemone route. Left empty, the judge stays the generative model."
              control={
                <div className="flex w-72 flex-col gap-1">
                  <Input
                    id={ENDPOINT_INPUT_ID}
                    type="url"
                    className="font-mono text-xs"
                    placeholder="https://api.typesafe.ai"
                    value={value.url}
                    aria-invalid={urlValid ? undefined : true}
                    onChange={(event) => setValue({ ...value, url: event.target.value })}
                  />
                  {urlValid ? null : <FieldError>{URL_ERROR}</FieldError>}
                </div>
              }
            />
          ) : null}
          {custom ? (
            <SettingsRow
              title={<label htmlFor={MODEL_INPUT_ID}>Decision model</label>}
              description="The model the custom endpoint is asked for."
              control={
                <Input
                  id={MODEL_INPUT_ID}
                  className="w-72 font-mono text-xs"
                  placeholder={DEFAULT_DECISIONS_MODEL}
                  value={value.model}
                  onChange={(event) => setValue({ ...value, model: event.target.value })}
                />
              }
            />
          ) : null}
          <DecisionsKeyRow
            provider={value.provider}
            savedNames={savedNames}
            onSave={handleSaveKey}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title="Nudges"
        description="A cheaper model looks at a call that trips a deterministic probe and decides whether to interrupt you."
      >
        <SettingsCard>
          <SettingsRow
            title="Nudge before damage"
            description="Shadow watches and records what it would have done without pausing anything. Nudge lets the judge stop a call and ask you. Default shadows until a decision provider is ready, then nudges."
            control={
              <ChoiceSelect
                label="Nudge before damage"
                items={CLASSIFIER_MODE_ITEMS}
                value={value.classifierMode}
                onChange={(classifierMode) => setValue({ ...value, classifierMode })}
              />
            }
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Web search" description="Which service the web_search tool asks.">
        <SettingsCard>
          <SettingsRow
            title="Search backend"
            description="DuckDuckGo needs no account. The others answer better in exchange for a key of your own, and the ones that return page text save the agent a fetch per result."
            control={
              <ChoiceSelect
                label="Search backend"
                items={SEARCH_BACKEND_ITEMS}
                value={value.searchBackend}
                onChange={(searchBackend) => setValue({ ...value, searchBackend })}
              />
            }
          />
          <SearchKeyRow
            backend={value.searchBackend}
            savedNames={savedNames}
            onSave={handleSaveKey}
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
      <ConfigFooter
        dirty={dirty}
        canSave={canSave}
        onDiscard={handleDiscardAll}
        onSave={() => void handleSaveAll()}
      />
    </SettingsPage>
  )
}
