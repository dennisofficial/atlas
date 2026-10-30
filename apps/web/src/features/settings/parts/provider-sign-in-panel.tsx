'use client'

import { useState } from 'react'
import { AlertCircleIcon, CheckIcon, CopyIcon, ExternalLinkIcon } from 'lucide-react'

import { Alert, AlertAction, AlertDescription } from '@dltech/atlas-ui/components/alert'
import { Button } from '@dltech/atlas-ui/components/button'
import { Input } from '@dltech/atlas-ui/components/input'
import { Spinner } from '@dltech/atlas-ui/components/spinner'

import {
  EProviderSignInState,
  type ProviderSignInControl,
} from '../data/personal/use-provider-sign-in'
import { Mono } from '../settings-layout'

const COPIED_FLASH_MS = 1600

function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code).catch(() => undefined)
    setCopied(true)
    window.setTimeout(() => setCopied(false), COPIED_FLASH_MS)
  }
  return (
    <Button variant="outline" size="xs" onClick={handleCopy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? 'Copied' : 'Copy code'}
    </Button>
  )
}

function OpenLink({ href, label }: { href: string; label: string }) {
  return (
    <Button
      variant="outline"
      size="xs"
      nativeButton={false}
      render={<a href={href} target="_blank" rel="noopener noreferrer" />}
    >
      <ExternalLinkIcon />
      {label}
    </Button>
  )
}

function PasteCodeForm({
  authorizeUrl,
  name,
  submitting,
  onSubmit,
  onCancel,
}: {
  authorizeUrl: string
  name: string
  submitting: boolean
  onSubmit: (code: string) => void
  onCancel: () => void
}) {
  const [code, setCode] = useState('')
  const canSubmit = code.trim().length > 0 && !submitting
  return (
    <form
      className="flex flex-col gap-3 pl-12"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) onSubmit(code)
      }}
    >
      <p className="text-sm text-muted-foreground">
        Approve Atlas in the {name} tab, then paste the code it shows you here.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-sm min-w-48 flex-1 font-mono"
          aria-label={`${name} authorization code`}
          placeholder="Paste the code"
          autoComplete="off"
          spellCheck={false}
          value={code}
          disabled={submitting}
          onChange={(event) => setCode(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={!canSubmit}>
          {submitting ? <Spinner /> : null}
          Finish sign-in
        </Button>
        <OpenLink href={authorizeUrl} label={`Open ${name} sign-in`} />
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function ProviderSignInPanel({
  name,
  control,
}: {
  name: string
  control: ProviderSignInControl
}) {
  const { flow, start, cancel, submitCode } = control

  if (flow.status === EProviderSignInState.Idle) return null

  if (flow.status === EProviderSignInState.Starting) {
    return (
      <p className="flex items-center gap-2 pl-12 text-sm text-muted-foreground" role="status">
        <Spinner /> Starting sign-in
      </p>
    )
  }

  if (flow.status === EProviderSignInState.Failed) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertDescription>{flow.message}</AlertDescription>
        <AlertAction>
          <Button variant="outline" size="xs" onClick={start}>
            Try again
          </Button>
          <Button variant="ghost" size="xs" onClick={cancel}>
            Cancel
          </Button>
        </AlertAction>
      </Alert>
    )
  }

  if (flow.status === EProviderSignInState.Waiting) {
    return (
      <div className="flex flex-col gap-3 pl-12" role="status">
        <p className="text-sm text-muted-foreground">
          Enter this code on the {name} page to approve Atlas.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Mono className="text-lg font-semibold tracking-widest">{flow.userCode}</Mono>
          <CopyCodeButton code={flow.userCode} />
          <OpenLink href={flow.verificationUrl} label={`Open ${name}`} />
          <Button variant="ghost" size="xs" onClick={cancel}>
            Cancel
          </Button>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner /> Waiting for approval…
        </p>
      </div>
    )
  }

  return (
    <PasteCodeForm
      authorizeUrl={flow.authorizeUrl}
      name={name}
      submitting={flow.status === EProviderSignInState.Submitting}
      onSubmit={submitCode}
      onCancel={cancel}
    />
  )
}
