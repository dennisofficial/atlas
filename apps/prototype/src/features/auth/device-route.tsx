'use client'

import { useSearchParams } from 'next/navigation'

import { usePrototype } from '@/proto/use-prototype'

import { DeviceConfirmScreen } from './device-confirm-screen'
import { DeviceEnterScreen } from './device-enter-screen'
import { DeviceResultScreen, EDeviceResult } from './device-result-screen'
import { EDeviceStep, ESignInContext, ESignInState, parseEnum, selectOf } from './auth-states'
import { AUTH_DEVICE_CODE } from './fixtures/auth'
import { SignInScreen } from './sign-in-screen'

const CONTROLS = {
  step: selectOf({ label: 'Step', values: EDeviceStep, fallback: EDeviceStep.EnterCode }),
}

export function DeviceRoute() {
  const values = usePrototype(CONTROLS)
  const code = useSearchParams().get('user_code') ?? AUTH_DEVICE_CODE
  const step = parseEnum({ values: EDeviceStep, raw: values.step, fallback: EDeviceStep.EnterCode })

  switch (step) {
    case EDeviceStep.EnterCode:
      return <DeviceEnterScreen />
    case EDeviceStep.Confirm:
      return <DeviceConfirmScreen code={code} busy={false} />
    case EDeviceStep.ConfirmBusy:
      return <DeviceConfirmScreen code={code} busy />
    case EDeviceStep.Approved:
      return <DeviceResultScreen result={EDeviceResult.Approved} />
    case EDeviceStep.Denied:
      return <DeviceResultScreen result={EDeviceResult.Denied} />
    case EDeviceStep.ExpiredCode:
      return <DeviceResultScreen result={EDeviceResult.Expired} />
    case EDeviceStep.SignedOut:
      return <SignInScreen state={ESignInState.Idle} context={ESignInContext.Device} />
  }
}
