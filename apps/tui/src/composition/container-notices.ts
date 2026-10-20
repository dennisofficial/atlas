export const currentLocationNotice = (placed: boolean): string =>
  placed ? 'this conversation runs in a pod or a cloud sandbox' : 'this conversation has not started yet — it is placed on its first message'

export const resourcesUnplacedNotice =
  'sandbox resources can only be resized once the conversation has started — the default for new sandboxes is in settings (ctrl+o) › cloud'

export const resourcesConnectingNotice =
  'the sandbox is still connecting — /container resources works once the channel is open'
