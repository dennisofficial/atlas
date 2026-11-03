declare const ATLAS_DAEMON_VERSION: string | undefined

export const DAEMON_VERSION: string =
  typeof ATLAS_DAEMON_VERSION === 'undefined' ? 'dev' : ATLAS_DAEMON_VERSION
