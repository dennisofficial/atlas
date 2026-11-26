import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { EPushSkipReason, type TPushTokenResult } from './push-registration'

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
  return { status: 'ok', token }
}
