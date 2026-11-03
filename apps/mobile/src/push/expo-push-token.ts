import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { EPushPlatform } from '@dltech/atlas-wire/web'
import { Platform } from 'react-native'

export enum EPushSkipReason {
  NotNative = 'not-native',
  NotDevice = 'not-device',
  NoProjectId = 'no-project-id',
  PermissionDenied = 'permission-denied',
}

export type TPushTokenResult =
  | { status: 'ok'; token: string; platform: EPushPlatform }
  | { status: 'skipped'; reason: EPushSkipReason }

export const resolveProjectId = (): string | undefined =>
  Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined

export const getExpoPushToken = async (): Promise<TPushTokenResult> => {
  if (Platform.OS !== 'ios') {
    return { status: 'skipped', reason: EPushSkipReason.NotNative }
  }
  if (!Device.isDevice) {
    return { status: 'skipped', reason: EPushSkipReason.NotDevice }
  }
  const projectId = resolveProjectId()
  if (projectId === undefined) {
    return { status: 'skipped', reason: EPushSkipReason.NoProjectId }
  }
  const existing = await Notifications.getPermissionsAsync()
  const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted
  if (!granted) {
    return { status: 'skipped', reason: EPushSkipReason.PermissionDenied }
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
  return { status: 'ok', token, platform: EPushPlatform.Ios }
}
