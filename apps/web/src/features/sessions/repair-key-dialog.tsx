'use client'

import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@dltech/atlas-ui/components/dialog'
import { Input } from '@dltech/atlas-ui/components/input'
import { Spinner } from '@dltech/atlas-ui/components/spinner'

export function RepairKeyDialog(props: {
  open: boolean
  failing: boolean
  providerLabel: string | undefined
  onOpenChange: (open: boolean) => void
  onSubmit: (apiKey: string) => void
}) {
  const [apiKey, setApiKey] = useState('')
  const canSubmit = apiKey.trim().length > 0 && !props.failing
  const handleOpenChange = (open: boolean) => {
    if (!open) setApiKey('')
    props.onOpenChange(open)
  }
  const handleSubmit = () => {
    if (!canSubmit) return
    props.onSubmit(apiKey.trim())
    setApiKey('')
  }
  return (
    <Dialog open={props.open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Replace the {props.providerLabel ?? 'provider'} key</DialogTitle>
          <DialogDescription>
            Atlas saves the new key and retries the turn that stopped.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            handleSubmit()
          }}
        >
          <Input
            type="password"
            aria-label="API key"
            placeholder="Paste the new key"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            disabled={props.failing}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {props.failing ? <Spinner /> : null}
              Save key and retry
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
