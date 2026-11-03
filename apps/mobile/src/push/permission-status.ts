import * as Notifications from 'expo-notifications'

export const readPermissionStatus = async (): Promise<string> => {
  try {
    const { status } = await Notifications.getPermissionsAsync()
    return status
  } catch {
    return 'unavailable'
  }
}
