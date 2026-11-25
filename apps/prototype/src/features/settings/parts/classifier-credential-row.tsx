'use client'

import Link from 'next/link'
import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'

import { ESettingsPage, hrefOfPage } from '../settings-nav'
import { Mono, SettingsRow } from '../settings-layout'

const PROVIDERS_HREF = hrefOfPage(ESettingsPage.Providers)

export function ClassifierCredentialRow({
  providerLabel,
  planOnly,
  existing,
}: {
  providerLabel: string
  planOnly: boolean
  existing: string | null
}) {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(existing !== null)
  const description = saved
    ? `Key: ${providerLabel} · ${existing ?? 'new key'}`
    : planOnly
      ? `${providerLabel} is connected by a plan, which cannot serve a classifier. Add a ${providerLabel} API key.`
      : `${providerLabel} is not connected.`

  const handleSave = () => {
    setSaved(true)
    setValue('')
  }

  return (
    <SettingsRow
      title={`${providerLabel} key`}
      description={saved ? <Mono className="text-foreground">{description}</Mono> : description}
      control={
        <>
          <Input
            type="password"
            autoComplete="off"
            className="w-56 font-mono text-xs"
            placeholder={saved ? 'Replace the saved key' : 'Paste your API key'}
            aria-label={`${providerLabel} API key`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={value.trim().length === 0}
            onClick={handleSave}
          >
            {saved ? 'Replace key' : 'Save key'}
          </Button>
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
