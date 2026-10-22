import { EAuthScreen, EDeviceConfirmState, type AuthRoute } from './auth-route'

export function deviceCodeOf(route: AuthRoute): string | null {
  if (route.screen === EAuthScreen.DeviceConfirm && route.state !== EDeviceConfirmState.Busy)
    return route.code ?? null
  return null
}
