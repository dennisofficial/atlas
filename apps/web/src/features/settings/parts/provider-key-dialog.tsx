'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import { Checkbox } from '@dltech/atlas-ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@dltech/atlas-ui/components/dialog'
import { Input } from '@dltech/atlas-ui/components/input'
import { Label } from '@dltech/atlas-ui/components/label'

import { DEFAULT_API_KEY_LABEL } from '../data/personal/accounts-api'

export enum EKeyDialogMode {
  Add = 'add',
  Replace = 'replace',
  Rename = 'rename',
}

export type KeyDialogResult = { name: string; key: string; use: boolean }

const TITLES: Record<EKeyDialogMode, string> = {
  [EKeyDialogMode.Add]: 'Add API key',
  [EKeyDialogMode.Replace]: 'Replace API key',
  [EKeyDialogMode.Rename]: 'Rename API key',
}

const NOT_ACCEPTED = 'This key was not accepted. Check it and try again.'

function KeyForm({
  providerName,
  keyPrefix,
  mode,
  initialName,
  offerUse,
  onCancel,
  onSave,
}: {
  providerName: string
  keyPrefix: string
  mode: EKeyDialogMode
  initialName: string
  offerUse: boolean
  onCancel: () => void
  onSave: (result: KeyDialogResult) => Promise<string | null>
}) {
  const [name, setName] = useState(initialName)
  const [key, setKey] = useState('')
  const [use, setUse] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const asksName = mode !== EKeyDialogMode.Replace
  const asksKey = mode !== EKeyDialogMode.Rename
  const ready = asksKey ? key.trim().length > 0 : name.trim().length > 0

  const handleSave = async () => {
    setSaving(true)
    setFailure(null)
    const failureText = await onSave({
      name: name.trim() || DEFAULT_API_KEY_LABEL,
      key: key.trim(),
      use: offerUse && use,
    })
    setSaving(false)
    if (failureText !== null) {
      setFailure(failureText.length > 0 ? failureText : NOT_ACCEPTED)
      return
    }
    onCancel()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {TITLES[mode]} · {providerName}
        </DialogTitle>
        {asksKey ? (
          <DialogDescription>
            Stored encrypted and sent only to {providerName}. You cannot see it again after you save
            it.
          </DialogDescription>
        ) : null}
      </DialogHeader>
      <div className="flex flex-col gap-4">
        {asksName ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="provider-key-name">Name</Label>
            <Input
              id="provider-key-name"
              placeholder="Work, Personal, CI…"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        ) : null}
        {asksKey ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="provider-key-value">API key</Label>
            <Input
              id="provider-key-value"
              type="password"
              autoComplete="off"
              placeholder={keyPrefix.length > 0 ? `${keyPrefix}…` : 'Paste your API key'}
              className="font-mono"
              aria-invalid={failure !== null}
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            {failure !== null ? (
              <p role="alert" className="text-xs text-destructive">
                {failure}
              </p>
            ) : null}
          </div>
        ) : null}
        {offerUse ? (
          <Label className="font-normal">
            <Checkbox checked={use} onCheckedChange={setUse} />
            Use this key for {providerName} now
          </Label>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!ready || saving} onClick={() => void handleSave()}>
          {saving ? 'Checking…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  )
}

export function ProviderKeyDialog({
  providerName,
  keyPrefix,
  mode,
  open,
  initialName = '',
  offerUse = false,
  onOpenChange,
  onSave,
}: {
  providerName: string
  keyPrefix: string
  mode: EKeyDialogMode
  open: boolean
  initialName?: string
  offerUse?: boolean
  onOpenChange: (open: boolean) => void
  onSave: (result: KeyDialogResult) => Promise<string | null>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <KeyForm
          key={`${mode}-${open}`}
          providerName={providerName}
          keyPrefix={keyPrefix}
          mode={mode}
          initialName={initialName}
          offerUse={offerUse}
          onCancel={() => onOpenChange(false)}
          onSave={onSave}
        />
      </DialogContent>
    </Dialog>
  )
}
