'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import {
  classifierAvailabilityIn,
  classifierFeaturesOf,
  classifierModelItems,
  classifierStatusOf,
  classifierSuggestionOf,
  type Accounts,
  type ClassifierTest,
} from '../fixtures/settings-classifier'
import { SaveFooter, SettingsCard, SettingsRow, SettingsSection } from '../settings-layout'
import { ChoiceSelect } from './agent-choice-select'

export function ClassifierCard({
  stored,
  accounts,
  lastTest,
  skillsSuggest,
  qualityEnabled,
  dirty,
  credentialRow,
  onPickModel,
  onTest,
  onSave,
  onDiscard,
}: {
  stored: string
  accounts: Accounts
  lastTest: ClassifierTest | null
  skillsSuggest: boolean
  qualityEnabled: boolean
  dirty: boolean
  credentialRow: ReactNode
  onPickModel: (model: string) => void
  onTest: () => void
  onSave: () => void
  onDiscard: () => void
}) {
  const availability = classifierAvailabilityIn({ stored, accounts })
  const status = classifierStatusOf(availability)
  const suggestion = stored.length === 0 ? classifierSuggestionOf(accounts) : undefined
  const features = classifierFeaturesOf({ on: availability.on, skillsSuggest, qualityEnabled })

  return (
    <>
      <SettingsSection
        title="Model"
        description="One model answers the yes/no questions behind skill suggestion and the Jev code review. It is never your chat model."
      >
        <SettingsCard footer={<SaveFooter dirty={dirty} onDiscard={onDiscard} onSave={onSave} />}>
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
                {lastTest === null ? null : (
                  <span className="text-xs text-muted-foreground">{lastTest.text}</span>
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
                <Button variant="outline" size="sm" disabled={dirty} onClick={onTest}>
                  Test
                </Button>
              </>
            }
          />
          {suggestion === undefined ? null : (
            <SettingsRow
              title={`${suggestion.label} is available.`}
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
