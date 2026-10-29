'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import { cn } from '@dltech/atlas-ui/lib/utils'

import {
  decisionsKeyTarget,
  EKeyNoun,
  searchKeyTarget,
  type KeyTarget,
} from '../data/personal/agent-keys'
import type { EDecisionsProvider, ESearchBackend } from '../fixtures/settings-decisions'
import { SettingsRow } from '../settings-layout'

export type KeyEntry = { name: string; value: string; noun: EKeyNoun }

type KeyRowProps = {
  savedNames: ReadonlySet<string> | null
  onSave: (entry: KeyEntry) => Promise<boolean>
}

const STATUS_LABELS: Record<EKeyNoun, { saved: string; missing: string }> = {
  [EKeyNoun.Key]: { saved: 'Key saved', missing: 'No key saved' },
  [EKeyNoun.Url]: { saved: 'URL saved', missing: 'No URL saved' },
}

function KeyStatus({ target, saved }: { target: KeyTarget; saved: boolean }) {
  const labels = STATUS_LABELS[target.noun]
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-xs font-normal',
        saved ? 'text-muted-foreground' : 'text-warning',
      )}
    >
      <span
        className={cn('size-1.5 rounded-full', saved ? 'bg-success' : 'bg-warning')}
        aria-hidden
      />
      {saved ? labels.saved : labels.missing}
    </span>
  )
}

function KeyRow({ target, savedNames, onSave }: KeyRowProps & { target: KeyTarget }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const saved = savedNames?.has(target.name)
  const inputId = `agent-key-${target.name}`

  const handleSave = async () => {
    setSaving(true)
    const done = await onSave({ name: target.name, value: value.trim(), noun: target.noun })
    setSaving(false)
    if (done) setValue('')
  }

  return (
    <SettingsRow
      title={
        <>
          <label htmlFor={inputId}>{target.label}</label>
          {saved === undefined ? null : <KeyStatus target={target} saved={saved} />}
        </>
      }
      description={target.description}
      control={
        <>
          <Input
            id={inputId}
            type={target.masked ? 'password' : 'url'}
            autoComplete="off"
            className="w-56 font-mono text-xs"
            placeholder={saved ? `Replace the saved ${target.noun}` : `Paste the ${target.noun}`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={value.trim().length === 0 || saving}
            onClick={() => void handleSave()}
          >
            Save {target.noun}
          </Button>
        </>
      }
    />
  )
}

export function DecisionsKeyRow({
  provider,
  ...props
}: KeyRowProps & { provider: EDecisionsProvider }) {
  const target = decisionsKeyTarget(provider)
  return <KeyRow key={target.name} target={target} {...props} />
}

export function SearchKeyRow({ backend, ...props }: KeyRowProps & { backend: ESearchBackend }) {
  const target = searchKeyTarget(backend)
  if (target === null) return null
  return <KeyRow key={target.name} target={target} {...props} />
}
