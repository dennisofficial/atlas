'use client'

import { FieldError } from '@dltech/atlas-ui/components/field'
import { Input } from '@dltech/atlas-ui/components/input'

import {
  AGENT_DEFAULTS,
  CLASSIFIER_MODE_ITEMS,
  DECISIONS_PROVIDER_ITEMS,
  DEFAULT_DECISIONS_MODEL,
  EDecisionsProvider,
  isValidDecisionsUrl,
  SEARCH_BACKEND_ITEMS,
} from '../fixtures/settings-decisions'
import { CONTEXT_FIELDS, defaultsOf } from '../fixtures/settings-fields'
import { ConfigFooter } from '../parts/agent-config-footer'
import { ChoiceSelect } from '../parts/agent-choice-select'
import { DecisionsKeyRow, SearchKeyRow } from '../parts/agent-key-row'
import { SettingFieldRows } from '../parts/setting-fields'
import { SettingsCard, SettingsPage, SettingsRow, SettingsSection } from '../settings-layout'
import { useDraft } from '../use-draft'

const ENDPOINT_INPUT_ID = 'agent-decisions-url'
const MODEL_INPUT_ID = 'agent-decisions-model'
const URL_ERROR = 'Enter an absolute http:// or https:// URL'

export function AgentPage() {
  const agent = useDraft(AGENT_DEFAULTS)
  const fields = useDraft(defaultsOf(CONTEXT_FIELDS))
  const { value, setValue } = agent
  const custom = value.provider === EDecisionsProvider.Custom
  const urlValid = isValidDecisionsUrl(value.url)
  const dirty = agent.dirty || fields.dirty

  const handleDiscard = () => {
    agent.discard()
    fields.discard()
  }
  const handleSave = () => {
    agent.save()
    fields.save()
  }

  return (
    <SettingsPage
      title="Agent"
      description="How the agent judges risky tool calls, searches the web, reads context and compacts. Every sandbox loads these when it starts."
    >
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
          <DecisionsKeyRow provider={value.provider} />
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
          <SearchKeyRow backend={value.searchBackend} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title="Context and skills"
        description="What the agent reads before each turn, when it compacts, and where it works."
      >
        <SettingsCard>
          <SettingFieldRows
            fields={CONTEXT_FIELDS}
            value={fields.value}
            onChange={fields.setValue}
          />
        </SettingsCard>
      </SettingsSection>
      <ConfigFooter dirty={dirty} onDiscard={handleDiscard} onSave={handleSave} />
    </SettingsPage>
  )
}
