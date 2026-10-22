import { MailX } from "lucide-react";
import { useState } from "react";

import { Avatar, AvatarFallback } from "@dltech/atlas-ui/components/avatar";
import { Badge } from "@dltech/atlas-ui/components/badge";
import { Button } from "@dltech/atlas-ui/components/button";
import { Spinner } from "@dltech/atlas-ui/components/spinner";
import { cn } from "@dltech/atlas-ui/lib/utils";

import { AUTH_INVITER, AUTH_USER, AUTH_WORKSPACE } from "../../fixtures/auth";
import { AuthLink, CONTROL_CLASS } from "./auth-controls";
import { AuthHeading } from "./auth-heading";
import {
  EAuthScreen,
  EHomeState,
  EInviteState,
  ESignInContext,
  ESignInState,
  type ScreenProps,
} from "./auth-route";
import { EStatusTone, StatusIcon } from "./status-icon";
import { useDelayed } from "./use-demo";

enum EPending {
  None = "none",
  Accept = "accept",
  Decline = "decline",
}

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
  );
}

export function InviteScreen({ route, onNavigate }: ScreenProps<EAuthScreen.Invite>) {
  const state = route.state ?? EInviteState.SignedIn;
  const [pending, setPending] = useState(EPending.None);
  const later = useDelayed();
  const busy = pending !== EPending.None;

  const handleHome = () =>
    onNavigate?.({ screen: EAuthScreen.Home, state: EHomeState.SignedIn });

  const handleAct = (action: EPending.Accept | EPending.Decline) => {
    setPending(action);
    later(() => {
      setPending(EPending.None);
      handleHome();
    });
  };

  const handleSignIn = () =>
    onNavigate?.({
      screen: EAuthScreen.SignIn,
      state: ESignInState.Idle,
      context: ESignInContext.Invite,
    });

  if (state === EInviteState.Expired) {
    return (
      <div className="flex flex-col gap-6">
        <StatusIcon icon={MailX} tone={EStatusTone.Warning} />
        <AuthHeading
          title="This invitation has expired"
          description={`Invitations to ${AUTH_WORKSPACE.name} are valid for 7 days. Ask ${AUTH_INVITER.name} to send a new one.`}
        />
        <Button variant="outline" className={cn(CONTROL_CLASS, "w-full")} onClick={handleHome}>
          Go to Atlas Cloud
        </Button>
      </div>
    );
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
          <Button className={cn(CONTROL_CLASS, "w-full")} onClick={handleSignIn}>
            Sign in to accept
          </Button>
          <Button
            variant="outline"
            className={cn(CONTROL_CLASS, "w-full")}
            onClick={() => onNavigate?.({ screen: EAuthScreen.SignUp })}
          >
            Create account
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <AuthHeading
        title={`${AUTH_INVITER.name} invited you to ${AUTH_WORKSPACE.name}`}
        description="Accept to join the workspace and see its threads and repos."
      />
      <InviteCard />
      <div className="flex flex-col gap-2">
        <Button
          className={cn(CONTROL_CLASS, "w-full")}
          disabled={busy}
          onClick={() => handleAct(EPending.Accept)}
        >
          {pending === EPending.Accept && <Spinner data-icon="inline-start" />}
          Accept invitation
        </Button>
        <Button
          variant="ghost"
          className={cn(CONTROL_CLASS, "w-full")}
          disabled={busy}
          onClick={() => handleAct(EPending.Decline)}
        >
          Decline
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Joining as {AUTH_USER.email}. <AuthLink onPress={handleSignIn}>Not you?</AuthLink>
      </p>
    </div>
  );
}
