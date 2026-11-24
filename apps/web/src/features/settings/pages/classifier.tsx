'use client'

import { useState } from 'react'
import { providerLabelOf } from '@dltech/atlas-core'

import type { SettingChanges, SettingValues } from '@/lib/cloud-settings'
import { api, cloudCall } from '@/lib/api-client'

import { QueryPage, QuerySection } from '../data/personal/query-boundary'
import { useProviderAccounts } from '../data/personal/provider-accounts-query'
import { useCloudSettings } from '@/lib/cloud-settings'
import { useSettingsDraft } from '../data/personal/use-settings-draft'
import {
  createApiKeyAccount,
  EAccountKind,
  replaceApiKey,
  type Account,
} from '../data/personal/accounts-api'
import { errorMessageOf } from '../data/personal/error-message'
import { NotificationsSkeleton } from '../skeletons/agent-skeletons'
import { SettingsPage } from '../settings-layout'
import { ClassifierCard } from '../parts/classifier/classifier-card'
import { ClassifierCredentialRow } from '../parts/classifier/classifier-credential-row'
import {
  classifierAvailabilityIn,
  classifierChanges,
  classifierModelOf,
  classifierSettingsFrom,
  providerIdOf,
  type ClassifierTestLine,
} from '../parts/classifier/classifier-copy'

const TITLE = 'Classifier'
const DESCRIPTION =
  'One model answers the yes or no questions behind skill suggestion and the Jev code review. It is never your chat model.'

export function ClassifierPage() {
  const settings = useCloudSettings()
  const accounts = useProviderAccounts()
  return (
    <QueryPage
      query={settings.query}
      title={TITLE}
      description={DESCRIPTION}
      skeleton={<NotificationsSkeleton />}
    >
      {(values) => (
        <QuerySection query={accounts} title={TITLE} skeleton={<NotificationsSkeleton />}>
          {(data) => (
            <ClassifierEditor
              values={values}
              save={settings.save}
              accounts={data.accounts}
              reloadAccounts={accounts.reload}
            />
          )}
        </QuerySection>
      )}
    </QueryPage>
  )
}

function ClassifierEditor({
  values,
  save,
  accounts,
  reloadAccounts,
}: {
  values: SettingValues
  save: (changes: SettingChanges) => Promise<void>
  accounts: readonly Account[]
  reloadAccounts: () => void
}) {
  const { draft, saving, handleSave } = useSettingsDraft({
    values,
    fromValues: classifierSettingsFrom,
    toChanges: classifierChanges,
    save,
  })
  const [lastTest, setLastTest] = useState<ClassifierTestLine | null>(null)
  const [testing, setTesting] = useState(false)
  const stored = draft.value.model
  const model = classifierModelOf(stored)
  const availability = classifierAvailabilityIn({ stored, accounts })
  const skillsSuggest = values.get('skills.suggest') !== false
  const qualityEnabled = values.get('quality.enabled') === true
  const providerLabel = model === undefined ? '' : (providerLabelOf(model.provider) ?? '')
  const existing =
    model === undefined
      ? undefined
      : accounts.find(
          (account) => account.provider === model.provider && account.kind === EAccountKind.ApiKey,
        )

  const planOnly =
    model !== undefined &&
    accounts.some(
      (account) => account.provider === model.provider && account.kind === EAccountKind.Oauth,
    )

  const handleTest = async () => {
    setTesting(true)
    try {
      const result = await cloudCall(api.classifier.test.mutate())
      setLastTest(result)
    } catch (error) {
      setLastTest({ ok: false, fault: 'unreachable', detail: errorMessageOf(error) })
    } finally {
      setTesting(false)
    }
  }
  const handleAddKey = async (apiKey: string): Promise<string | null> => {
    if (model === undefined) return 'Pick a classifier first.'
    try {
      await createApiKeyAccount({ provider: providerIdOf(model.provider), apiKey })
    } catch (error) {
      return errorMessageOf(error)
    }
    reloadAccounts()
    return null
  }
  const handleReplaceKey = async (apiKey: string): Promise<string | null> => {
    if (existing === undefined) return 'Pick a classifier first.'
    try {
      await replaceApiKey({ accountId: existing.id, apiKey })
    } catch (error) {
      return errorMessageOf(error)
    }
    reloadAccounts()
    return null
  }
  const credentialRow =
    model !== undefined && !availability.on ? (
      <ClassifierCredentialRow
        providerLabel={providerLabel}
        planOnly={planOnly}
        existing={existing === undefined ? null : { label: existing.label }}
        onAdd={handleAddKey}
        onReplace={handleReplaceKey}
      />
    ) : null

  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      <ClassifierCard
        stored={stored}
        accounts={accounts}
        lastTest={lastTest}
        skillsSuggest={skillsSuggest}
        qualityEnabled={qualityEnabled}
        dirty={draft.dirty}
        saving={saving}
        testing={testing}
        credentialRow={credentialRow}
        onPickModel={(next) => draft.setValue({ model: next })}
        onTest={() => void handleTest()}
        onSave={() => void handleSave()}
        onDiscard={draft.discard}
      />
    </SettingsPage>
  )
}
