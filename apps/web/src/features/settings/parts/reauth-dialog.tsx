'use client'

import { useEffect, useState } from 'react'

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
import { Label } from '@dltech/atlas-ui/components/label'

import { googleSignInUrl, sessionUser, signIn } from '@/lib/auth-api'
import { listSignInMethods, type SignInMethodIds } from '@/lib/auth-accounts'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Could not confirm it’s you'

export function ReauthDialog({
  open,
  onOpenChange,
  onConfirmed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmed: () => void
}) {
  const [methods, setMethods] = useState<SignInMethodIds | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setPassword('')
    setError(null)
    void listSignInMethods().then(setMethods, (failure) => setError(messageOf(failure)))
    void sessionUser().then(
      (user) => setEmail(user?.email ?? ''),
      () => undefined,
    )
  }, [open])

  const handlePassword = async () => {
    setBusy(true)
    setError(null)
    try {
      await signIn({ email, password })
      onOpenChange(false)
      onConfirmed()
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  const handleGoogle = async () => {
    setBusy(true)
    setError(null)
    try {
      const next = `${window.location.pathname}${window.location.search}`
      window.location.href = await googleSignInUrl({ origin: window.location.origin, next })
    } catch (failure) {
      setError(messageOf(failure))
      setBusy(false)
    }
  }

  const hasPassword = methods?.password !== null && methods?.password !== undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm it’s you</DialogTitle>
          <DialogDescription>Sign in again to reveal values.</DialogDescription>
        </DialogHeader>
        {hasPassword ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reauth-password">Password</Label>
            <Input
              id="reauth-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        ) : null}
        {error === null ? null : <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {hasPassword ? (
            <Button size="sm" disabled={busy || password === ''} onClick={handlePassword}>
              Confirm
            </Button>
          ) : (
            <Button size="sm" disabled={busy || methods === null} onClick={handleGoogle}>
              Continue with Google
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
