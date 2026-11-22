import type { DeviceLogin, DevicePoll } from '@dltech/atlas-models/provider-oauth'

export {
  EDevicePoll,
  type DeviceLogin,
  type DevicePoll,
} from '@dltech/atlas-models/provider-oauth'

export interface DeviceLoginClient {
  startDeviceLogin(): Promise<DeviceLogin>
  pollDeviceLogin(args: { deviceAuthId: string; userCode: string }): Promise<DevicePoll>
}
