'use client'

import Link from 'next/link'

import { Mono, SettingsRow } from '../../settings-layout'
import { ESettingsPage, hrefOfPage } from '../../settings-nav'
import { KeyDialog } from '../agent-key-dialog'
import { classifierPlanOnlyText } from './classifier-copy'

const PROVIDERS_HREF = hrefOfPage(ESettingsPage.Providers)

export function ClassifierCredentialRow({
  providerLabel,
  planOnly,
  existing,
  onAdd,
  onReplace,
}: {
  providerLabel: string
  planOnly: boolean
  existing: { label: string } | null
  onAdd: (apiKey: string) => Promise<string | null>
  onReplace: (apiKey: string) => Promise<string | null>
}) {
  const description = planOnly
    ? classifierPlanOnlyText({ providerLabel })
    : `${providerLabel} is not connected.`
  return (
    <SettingsRow
      title={`${providerLabel} key`}
      description={
        existing === null ? (
          description
        ) : (
          <span className="flex items-center gap-2">
            <Mono className="text-foreground">
              Key: {providerLabel}, {existing.label}
            </Mono>
          </span>
        )
      }
      control={
        <>
          {existing === null ? (
            <KeyDialog
              providerName={providerLabel}
              placeholder="Paste your API key"
              triggerLabel={`Add a ${providerLabel} key`}
              primary
              onSave={onAdd}
            />
          ) : (
            <KeyDialog
              providerName={providerLabel}
              placeholder="Paste your API key"
              triggerLabel="Replace key"
              onSave={onReplace}
            />
          )}
          <Link
            href={PROVIDERS_HREF}
            className="text-xs text-muted-foreground underline underline-offset-4"
          >
            Open Providers
          </Link>
        </>
      }
    />
  )
}
