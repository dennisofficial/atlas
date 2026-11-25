'use client'

import { useState } from 'react'

import {
  CLASSIFIER_ACCOUNTS,
  CLASSIFIER_DEFAULTS,
  EClassifierOffReason,
  QUALITY_ENABLED,
  SKILLS_SUGGEST_ENABLED,
  classifierAvailabilityIn,
  classifierKeyLabelOf,
  classifierTestOf,
  providerNameOf,
  type ClassifierTest,
} from '../fixtures/settings-classifier'
import { ClassifierCard } from '../parts/classifier-card'
import { ClassifierCredentialRow } from '../parts/classifier-credential-row'
import { SettingsPage } from '../settings-layout'
import { useDraft } from '../use-draft'

const TITLE = 'Classifier'
const DESCRIPTION =
  'One model answers the yes or no questions behind skill suggestion and the Jev code review. It is never your chat model.'

export function ClassifierPage() {
  const draft = useDraft(CLASSIFIER_DEFAULTS)
  const [lastTest, setLastTest] = useState<ClassifierTest | null>(null)
  const availability = classifierAvailabilityIn({
    stored: draft.value.model,
    accounts: CLASSIFIER_ACCOUNTS,
  })
  const credentialRow =
    availability.on || availability.reason === EClassifierOffReason.NoModel ? null : (
      <ClassifierCredentialRow
        providerLabel={providerNameOf(availability.provider)}
        planOnly={availability.reason === EClassifierOffReason.PlanHasNoKey}
        existing={classifierKeyLabelOf({
          accounts: CLASSIFIER_ACCOUNTS,
          provider: availability.provider,
        })}
      />
    )

  const handleTest = () => setLastTest(classifierTestOf(availability))

  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      <ClassifierCard
        stored={draft.value.model}
        accounts={CLASSIFIER_ACCOUNTS}
        lastTest={lastTest}
        skillsSuggest={SKILLS_SUGGEST_ENABLED}
        qualityEnabled={QUALITY_ENABLED}
        dirty={draft.dirty}
        credentialRow={credentialRow}
        onPickModel={(model) => draft.setValue({ model })}
        onTest={handleTest}
        onSave={draft.save}
        onDiscard={draft.discard}
      />
    </SettingsPage>
  )
}
