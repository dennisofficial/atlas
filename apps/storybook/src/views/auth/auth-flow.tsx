import { useState } from "react";

import { Button } from "@dltech/atlas-ui/components/button";

import { AuthPreview } from "./auth-preview";
import {
  EAuthScreen,
  EDeviceConfirmState,
  EHomeState,
  EInviteState,
  EResetState,
  type AuthRoute,
} from "./auth-route";

const JUMPS: { label: string; route: AuthRoute }[] = [
  { label: "Home", route: { screen: EAuthScreen.Home, state: EHomeState.SignedOut } },
  { label: "Email: reset link", route: { screen: EAuthScreen.Reset, state: EResetState.Idle } },
  {
    label: "Terminal: device link",
    route: { screen: EAuthScreen.DeviceConfirm, state: EDeviceConfirmState.Idle },
  },
  { label: "Terminal: no code", route: { screen: EAuthScreen.DeviceEnter } },
  {
    label: "Email: invitation",
    route: { screen: EAuthScreen.Invite, state: EInviteState.SignedOut },
  },
];

export function AuthFlow({ start }: { start: AuthRoute }) {
  const [route, setRoute] = useState<AuthRoute>(start);

  return (
    <>
      <AuthPreview route={route} onNavigate={setRoute} />
      <nav
        aria-label="Prototype entry points"
        className="fixed bottom-3 left-3 z-50 flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center gap-1 rounded-xl border bg-popover p-1.5 text-xs shadow-lg"
      >
        <span className="px-2 text-muted-foreground">Jump to</span>
        {JUMPS.map((jump) => (
          <Button
            key={jump.label}
            variant="ghost"
            size="xs"
            onClick={() => setRoute(jump.route)}
          >
            {jump.label}
          </Button>
        ))}
      </nav>
    </>
  );
}
