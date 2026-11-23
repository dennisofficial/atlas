'use client'

import type { ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'
import Link from 'next/link'

import type { Account } from '../../data/personal/accounts-api'
import { SaveFooter, SettingsCard, SettingsRow, SettingsSection } from '../../settings-layout'
import { ChoiceSelect } from '../agent-choice-select'
import {
  classifierAvailabilityIn,
  classifierFeaturesOf,
  classifierModelItems,
  classifierStatusOf,
  classifierSuggestionOf,
  classifierTestLineOf,
  type ClassifierTestLine,
} from './classifier-copy'

export function ClassifierCard({
  stored,
  accounts,
  lastTest,
  skillsSuggest,
  qualityEnabled,
  dirty,
  saving,
  testing,
  credentialRow,
  onPickModel,
  onTest,
  onSave,
  onDiscard,
}: {
  stored: string
  accounts: readonly Account[]
  lastTest: ClassifierTestLine | null
  skillsSuggest: boolean
  qualityEnabled: boolean
  dirty: boolean
  saving: boolean
  testing: boolean
  credentialRow: ReactNode
  onPickModel: (model: string) => void
  onTest: () => void
  onSave: () => void
  onDiscard: () => void
}) {
  const availability = classifierAvailabilityIn({ stored, accounts })
  const status = classifierStatusOf(availability)
  const suggestion = stored.length === 0 ? classifierSuggestionOf(accounts) : undefined
  const testLine = classifierTestLineOf(lastTest)
  const features = classifierFeaturesOf({ on: availability.on, skillsSuggest, qualityEnabled })

  return (
    <>
      <SettingsSection
        title="Model"
        description="One model answers the yes/no questions behind skill suggestion and the Jev code review. It is never your chat model."
      >
        <SettingsCard
          footer={<SaveFooter dirty={dirty && !saving} onDiscard={onDiscard} onSave={onSave} />}
        >
          <SettingsRow
            title="Classifier"
            description={
              <span className="flex flex-col gap-1">
                <span
                  className={cn(
                    'flex items-center gap-1.5 text-xs',
                    status.tone === 'on' ? 'text-muted-foreground' : 'text-warning',
                  )}
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      status.tone === 'on' ? 'bg-success' : 'bg-warning',
                    )}
                    aria-hidden
                  />
                  {status.text}
                </span>
                {testLine === undefined ? null : (
                  <span className="text-xs text-muted-foreground">{testLine}</span>
                )}
                {dirty ? <span className="text-xs text-muted-foreground">Save first</span> : null}
              </span>
            }
            control={
              <>
                <ChoiceSelect
                  label="Classifier model"
                  items={classifierModelItems()}
                  value={stored}
                  onChange={onPickModel}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={dirty || testing || saving}
                  onClick={onTest}
                >
                  {testing ? 'Testing…' : 'Test'}
                </Button>
              </>
            }
          />
          {suggestion === undefined ? null : (
            <SettingsRow
              title={`${suggestion.providerLabel} is connected.`}
              description="Use the key you already saved for this provider."
              control={
                <Button variant="outline" size="sm" onClick={() => onPickModel(suggestion.ref)}>
                  Use {suggestion.label}
                </Button>
              }
            />
          )}
          {credentialRow}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Features that use it">
        <SettingsCard>
          {features.map((feature) => (
            <SettingsRow
              key={feature.label}
              title={feature.label}
              description={feature.state}
              control={
                <Link
                  href={feature.href}
                  className="text-xs text-muted-foreground underline underline-offset-4"
                >
                  {feature.linkLabel}
                </Link>
              }
            />
          ))}
        </SettingsCard>
      </SettingsSection>
    </>
  )
}
