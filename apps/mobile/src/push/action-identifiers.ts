export const NOTIFICATION_OPEN_ACTION = 'expo.modules.notifications.actions.DEFAULT'

// iOS reports a dismissal only for a notification whose category asks for that action, as a
// response whose action identifier is this constant. Expo passes it through unmapped.
// https://developer.apple.com/documentation/usernotifications/unnotificationdismissactionidentifier
export const NOTIFICATION_DISMISS_ACTION = 'com.apple.UNNotificationDismissActionIdentifier'
