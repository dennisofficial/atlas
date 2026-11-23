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

import type { ProviderInfo } from '../fixtures/settings-providers'

export enum EKeyDialog {
  Add = 'add',
  Replace = 'replace',
  Rename = 'rename',
}

export type KeyDialogResult = { name: string; key: string; use: boolean }

const TITLES: Record<EKeyDialog, string> = {
  [EKeyDialog.Add]: 'Add API key',
  [EKeyDialog.Replace]: 'Replace API key',
  [EKeyDialog.Rename]: 'Rename API key',
}

const DEFAULT_KEY_NAME = 'API key'

function KeyForm({
  provider,
  mode,
  initialName,
  offerUse,
  onCancel,
  onSave,
}: {
  provider: ProviderInfo
  mode: EKeyDialog
  initialName: string
  offerUse: boolean
  onCancel: () => void
  onSave: (result: KeyDialogResult) => void
}) {
  const [name, setName] = useState(initialName)
  const [key, setKey] = useState('')
  const [use, setUse] = useState(false)
  const asksName = mode !== EKeyDialog.Replace
  const asksKey = mode !== EKeyDialog.Rename
  const ready = asksKey ? key.trim().length > 0 : name.trim().length > 0

  const handleSave = () =>
    onSave({ name: name.trim() || DEFAULT_KEY_NAME, key: key.trim(), use: offerUse && use })

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {TITLES[mode]} · {provider.name}
        </DialogTitle>
        {asksKey ? (
          <DialogDescription>
            Stored encrypted and sent only to {provider.name}. You cannot see it again after you
            save it.
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
              placeholder={provider.keyPrefix ? `${provider.keyPrefix}…` : 'Paste your API key'}
              className="font-mono"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </div>
        ) : null}
        {offerUse ? (
          <Label className="flex items-center gap-2 font-normal">
            <Checkbox checked={use} onCheckedChange={setUse} />
            Use this key for {provider.name} now
          </Label>
        ) : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={!ready} onClick={handleSave}>
          Save
        </Button>
      </DialogFooter>
    </>
  )
}

export function KeyDialog({
  provider,
  mode,
  open,
  initialName = '',
  offerUse = false,
  onOpenChange,
  onSave,
}: {
  provider: ProviderInfo
  mode: EKeyDialog
  open: boolean
  initialName?: string
  offerUse?: boolean
  onOpenChange: (open: boolean) => void
  onSave: (result: KeyDialogResult) => void
}) {
  const handleSave = (result: KeyDialogResult) => {
    onSave(result)
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <KeyForm
          provider={provider}
          mode={mode}
          initialName={initialName}
          offerUse={offerUse}
          onCancel={() => onOpenChange(false)}
          onSave={handleSave}
        />
      </DialogContent>
    </Dialog>
  )
}
