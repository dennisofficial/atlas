import { MailX } from 'lucide-react'

import { Avatar, AvatarFallback } from '@dltech/atlas-ui/components/avatar'
import { Badge } from '@dltech/atlas-ui/components/badge'

import { AuthLink, LinkButton } from './auth-controls'
import { AuthHeading } from './auth-heading'
import { AUTH_PATHS, signInHref } from './auth-paths'
import { EInviteState, ESignInContext } from './auth-states'
import { AUTH_INVITER, AUTH_USER, AUTH_WORKSPACE } from './fixtures/auth'
import { EStatusTone, StatusIcon } from './status-icon'

function InviteCard() {
  return (
    <div className="flex items-center gap-4 rounded-xl border bg-muted/40 p-4">
      <Avatar size="lg">
        <AvatarFallback className="font-display font-semibold">
          {AUTH_WORKSPACE.initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-display text-lg font-semibold text-foreground">
          {AUTH_WORKSPACE.name}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">Member</Badge>
          Invited by {AUTH_INVITER.name}
        </span>
      </div>
    </div>
  )
}

export function InviteScreen({ state }: { state: EInviteState }) {
  const signInUrl = signInHref(ESignInContext.Invite)

  if (state === EInviteState.Expired) {
    return (
      <div className="flex flex-col gap-6">
        <StatusIcon icon={MailX} tone={EStatusTone.Warning} />
        <AuthHeading
          title="This invitation has expired"
          description={`Invitations to ${AUTH_WORKSPACE.name} are valid for 7 days. Ask ${AUTH_INVITER.name} to send a new one.`}
        />
        <LinkButton href={AUTH_PATHS.home} variant="outline">
          Go to Atlas Cloud
        </LinkButton>
      </div>
    )
  }

  if (state === EInviteState.SignedOut) {
    return (
      <div className="flex flex-col gap-6">
        <AuthHeading
          title={`${AUTH_INVITER.name} invited you to ${AUTH_WORKSPACE.name}`}
          description="Sign in or create an account to accept. The invitation is waiting for you."
        />
        <InviteCard />
        <div className="flex flex-col gap-2">
          <LinkButton href={signInUrl}>Sign in to accept</LinkButton>
          <LinkButton href={AUTH_PATHS.signUp} variant="outline">
            Create account
          </LinkButton>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title={`${AUTH_INVITER.name} invited you to ${AUTH_WORKSPACE.name}`}
        description="Accept to join the workspace and see its threads and repos."
      />
      <InviteCard />
      <div className="flex flex-col gap-2">
        <LinkButton href={AUTH_PATHS.newThread}>Accept invitation</LinkButton>
        <LinkButton href={AUTH_PATHS.home} variant="ghost">
          Decline
        </LinkButton>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Joining as {AUTH_USER.email}. <AuthLink href={signInUrl}>Not you?</AuthLink>
      </p>
    </div>
  )
}
