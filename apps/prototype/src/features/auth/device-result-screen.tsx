import { CircleCheck, CircleX, TimerOff } from 'lucide-react'

import { LinkButton } from './auth-controls'
import { AuthHeading } from './auth-heading'
import { AUTH_PATHS } from './auth-paths'
import { EStatusTone, StatusIcon } from './status-icon'
import { AUTH_LOGIN_COMMAND } from './fixtures/auth'

export enum EDeviceResult {
  Approved = 'approved',
  Denied = 'denied',
  Expired = 'expired',
}

export function DeviceResultScreen({ result }: { result: EDeviceResult }) {
  if (result === EDeviceResult.Approved) {
    return (
      <div className="flex flex-col gap-6">
        <StatusIcon icon={CircleCheck} tone={EStatusTone.Success} />
        <AuthHeading
          title="Return to your terminal"
          description="Your device is authorized. Atlas in your terminal will finish signing in on its own, and you can close this tab."
        />
        <LinkButton href={AUTH_PATHS.home} variant="outline">
          Go to Atlas Cloud
        </LinkButton>
      </div>
    )
  }

  if (result === EDeviceResult.Denied) {
    return (
      <div className="flex flex-col gap-6">
        <StatusIcon icon={CircleX} tone={EStatusTone.Destructive} />
        <AuthHeading
          title="Request denied"
          description="The device was not signed in. If this wasn't you, no action is needed."
        />
        <LinkButton href={AUTH_PATHS.home} variant="outline">
          Go to Atlas Cloud
        </LinkButton>
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
      <LinkButton href={AUTH_PATHS.device}>Enter a different code</LinkButton>
    </div>
  )
}
