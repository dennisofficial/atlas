'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import { cn } from '@dltech/atlas-ui/lib/utils'

import {
  decisionsKeyTarget,
  EKeyNoun,
  SAVED_KEY_NAMES,
  searchKeyTarget,
  type EDecisionsProvider,
  type ESearchBackend,
  type KeyTarget,
} from '../fixtures/settings-decisions'
import { SettingsRow } from '../settings-layout'

function KeyStatus({ noun, saved }: { noun: EKeyNoun; saved: boolean }) {
  const label = noun === EKeyNoun.Url ? 'URL' : 'Key'
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
      {saved ? `${label} saved` : `No ${label.toLowerCase()} saved`}
    </span>
  )
}

function KeyRow({ target }: { target: KeyTarget }) {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(SAVED_KEY_NAMES.has(target.name))
  const inputId = `agent-key-${target.name}`

  const handleSave = () => {
    setSaved(true)
    setValue('')
  }

  return (
    <SettingsRow
      title={
        <>
          <label htmlFor={inputId}>{target.label}</label>
          <KeyStatus noun={target.noun} saved={saved} />
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
            disabled={value.trim().length === 0}
            onClick={handleSave}
          >
            Save {target.noun}
          </Button>
        </>
      }
    />
  )
}

export function DecisionsKeyRow({ provider }: { provider: EDecisionsProvider }) {
  const target = decisionsKeyTarget(provider)
  return <KeyRow key={target.name} target={target} />
}

export function SearchKeyRow({ backend }: { backend: ESearchBackend }) {
  const target = searchKeyTarget(backend)
  if (target === null) return null
  return <KeyRow key={target.name} target={target} />
}
