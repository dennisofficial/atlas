import { CircleCheck, CircleX, TimerOff } from 'lucide-react'

import { AuthHeading } from './auth-heading'
import { LinkButton } from './auth-controls'
import { EStatusTone, StatusIcon } from './status-icon'

export enum EDeviceResult {
  Approved = 'approved',
  Denied = 'denied',
  Expired = 'expired',
}

export function DeviceResult({ result }: { result: EDeviceResult }) {
  if (result === EDeviceResult.Approved) {
    return (
      <div className="flex flex-col gap-6">
        <StatusIcon icon={CircleCheck} tone={EStatusTone.Success} />
        <AuthHeading
          title="Return to your terminal"
          description="Your device is authorized. Atlas in your terminal will finish signing in on its own, and you can close this tab."
        />
        <LinkButton href="/threads" variant="outline">
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
        <LinkButton href="/threads" variant="outline">
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
        description="Device codes expire after 30 minutes. Run atlas login again to get a fresh one."
      />
      <LinkButton href="/device">Enter a different code</LinkButton>
    </div>
  )
}
