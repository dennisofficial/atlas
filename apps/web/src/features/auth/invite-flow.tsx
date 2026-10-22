'use client'

import { MailX, UserX } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Avatar, AvatarFallback } from '@dltech/atlas-ui/components/avatar'
import { Badge } from '@dltech/atlas-ui/components/badge'
import { Button } from '@dltech/atlas-ui/components/button'
import { Spinner } from '@dltech/atlas-ui/components/spinner'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { sessionUser, signOut, UNREACHABLE } from '@/lib/auth-api'
import {
  acceptInvitation,
  getInvitation,
  isWrongRecipientError,
  OrganizationApiError,
  rejectInvitation,
  setActiveOrganization,
  type Invitation,
} from '@/lib/organization-api'
import { initialsOf } from '@/features/settings/session/initials'

import { AuthLinkButton, CONTROL_CLASS, FormError, LinkButton } from './auth-controls'
import { AuthHeading } from './auth-heading'
import { PageSpinner } from './page-spinner'
import { EStatusTone, StatusIcon } from './status-icon'

enum EInviteStep {
  Checking = 'checking',
  Ready = 'ready',
  Unavailable = 'unavailable',
  WrongAccount = 'wrong-account',
}

enum EPending {
  Accept = 'accept',
  Decline = 'decline',
}

const roleLabel = (role: string): string =>
  role.length === 0 ? 'Member' : `${role.charAt(0).toUpperCase()}${role.slice(1)}`

function InviteCard({ invitation }: { invitation: Invitation }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border bg-muted/40 p-4">
      <Avatar size="lg">
        <AvatarFallback className="font-display font-semibold">
          {initialsOf(invitation.organizationName)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-display text-lg font-semibold text-foreground">
          {invitation.organizationName}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{roleLabel(invitation.role)}</Badge>
          <span className="truncate">Invited by {invitation.inviterEmail}</span>
        </span>
      </div>
    </div>
  )
}

export function InviteFlow({ invitationId }: { invitationId: string }) {
  const router = useRouter()
  const returnPath = `/invite/${invitationId}`
  const [step, setStep] = useState(EInviteStep.Checking)
  const [invitation, setInvitation] = useState<Invitation | null>(null)
  const [email, setEmail] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, setPending] = useState<EPending | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const user = await sessionUser().catch(() => null)
      if (user === null) {
        router.replace(`/sign-in?next=${encodeURIComponent(returnPath)}`)
        return
      }
      try {
        const found = await getInvitation(invitationId)
        if (cancelled) return
        setEmail(user.email)
        setInvitation(found)
        setStep(EInviteStep.Ready)
      } catch (cause) {
        if (cancelled) return
        setEmail(user.email)
        if (isWrongRecipientError(cause)) {
          setStep(EInviteStep.WrongAccount)
          return
        }
        setFailure(
          cause instanceof OrganizationApiError && cause.message === UNREACHABLE
            ? UNREACHABLE
            : null,
        )
        setStep(EInviteStep.Unavailable)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [invitationId, returnPath, router])

  const handleSwitchAccount = async () => {
    await signOut().catch(() => undefined)
    router.replace(`/sign-in?next=${encodeURIComponent(returnPath)}`)
  }

  const handleAccept = async () => {
    if (invitation === null) return
    setPending(EPending.Accept)
    setError(null)
    try {
      await acceptInvitation(invitation.id)
      await setActiveOrganization({ organizationId: invitation.organizationId })
      router.push('/threads/new')
    } catch (cause) {
      setError(
        cause instanceof OrganizationApiError ? cause.message : 'Could not accept the invitation',
      )
      setPending(null)
    }
  }

  const handleDecline = async () => {
    if (invitation === null) return
    setPending(EPending.Decline)
    setError(null)
    try {
      await rejectInvitation(invitation.id)
      router.push('/setup')
    } catch (cause) {
      setError(
        cause instanceof OrganizationApiError ? cause.message : 'Could not decline the invitation',
      )
      setPending(null)
    }
  }

  if (step === EInviteStep.Checking) return <PageSpinner label="Loading invitation…" />

  if (step === EInviteStep.WrongAccount) {
    return (
      <div className="flex flex-col gap-6">
        <StatusIcon icon={UserX} tone={EStatusTone.Warning} />
        <AuthHeading
          title="This invitation is for another account"
          description={`You're signed in as ${email}. Sign in with the email address that was invited.`}
        />
        <Button className={cn(CONTROL_CLASS, 'w-full')} onClick={() => void handleSwitchAccount()}>
          Switch account
        </Button>
      </div>
    )
  }

  if (step === EInviteStep.Unavailable || invitation === null) {
    return (
      <div className="flex flex-col gap-6">
        <StatusIcon icon={MailX} tone={EStatusTone.Warning} />
        <AuthHeading
          title="This invitation has expired"
          description="Invitations are valid for 48 hours and work once. Ask the person who invited you to send a new one."
        />
        {failure !== null && <FormError>{failure}</FormError>}
        <LinkButton href="/" variant="outline">
          Go to Atlas Cloud
        </LinkButton>
      </div>
    )
  }

  const busy = pending !== null

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title={`${invitation.inviterEmail} invited you to ${invitation.organizationName}`}
        description="Accept to join the workspace and see its threads and repos."
      />
      <InviteCard invitation={invitation} />
      {error !== null && <FormError>{error}</FormError>}
      <div className="flex flex-col gap-2">
        <Button
          className={cn(CONTROL_CLASS, 'w-full')}
          disabled={busy}
          onClick={() => void handleAccept()}
        >
          {pending === EPending.Accept && <Spinner data-icon="inline-start" />}
          Accept invitation
        </Button>
        <Button
          variant="ghost"
          className={cn(CONTROL_CLASS, 'w-full')}
          disabled={busy}
          onClick={() => void handleDecline()}
        >
          {pending === EPending.Decline && <Spinner data-icon="inline-start" />}
          Decline
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Joining as {email}.{' '}
        <AuthLinkButton onClick={() => void handleSwitchAccount()}>Not you?</AuthLinkButton>
      </p>
    </div>
  )
}
