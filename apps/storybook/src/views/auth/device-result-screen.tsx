import { CircleCheck, CircleX, TimerOff } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import { cn } from '@dltech/atlas-ui/lib/utils'

import { AUTH_LOGIN_COMMAND } from '../../fixtures/auth'
import { CONTROL_CLASS } from './auth-controls'
import { AuthHeading } from './auth-heading'
import { EAuthScreen, EDeviceResultState, EHomeState, type ScreenProps } from './auth-route'
import { EStatusTone, StatusIcon } from './status-icon'

export function DeviceResultScreen({ route, onNavigate }: ScreenProps<EAuthScreen.DeviceResult>) {
  const state = route.state ?? EDeviceResultState.Approved

  const handleRetry = () => onNavigate?.({ screen: EAuthScreen.DeviceEnter })
  const handleHome = () => onNavigate?.({ screen: EAuthScreen.Home, state: EHomeState.SignedIn })

  if (state === EDeviceResultState.Approved) {
    return (
      <div className="flex flex-col gap-6">
        <StatusIcon icon={CircleCheck} tone={EStatusTone.Success} />
        <AuthHeading
          title="Return to your terminal"
          description="Your device is authorized. Atlas in your terminal will finish signing in on its own, and you can close this tab."
        />
        <Button variant="outline" className={cn(CONTROL_CLASS, 'w-full')} onClick={handleHome}>
          Go to Atlas Cloud
        </Button>
      </div>
    )
  }

  if (state === EDeviceResultState.Denied) {
    return (
      <div className="flex flex-col gap-6">
        <StatusIcon icon={CircleX} tone={EStatusTone.Destructive} />
        <AuthHeading
          title="Request denied"
          description="The device was not signed in. If this wasn't you, no action is needed."
        />
        <Button variant="outline" className={cn(CONTROL_CLASS, 'w-full')} onClick={handleHome}>
          Go to Atlas Cloud
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <StatusIcon icon={TimerOff} tone={EStatusTone.Warning} />
      <AuthHeading
        title="Code expired or not recognized"
        description={`Device codes expire after 15 minutes. Run ${AUTH_LOGIN_COMMAND} again to get a fresh one.`}
      />
      <Button className={cn(CONTROL_CLASS, 'w-full')} onClick={handleRetry}>
        Enter a different code
      </Button>
    </div>
  )
}
