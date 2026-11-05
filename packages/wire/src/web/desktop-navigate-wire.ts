export const DESKTOP_NAVIGATE_EVENT = 'atlas-desktop:navigate'

export const isInAppPath = (path: string): boolean =>
  path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')
