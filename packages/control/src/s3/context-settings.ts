import { changesSettingsOf, type ChangesSettings } from './changes-settings'

export const CONTEXT_S3_PREFIX = 'context-files'

export const contextSettingsOf = (env: Record<string, string | undefined>): ChangesSettings => ({
  ...changesSettingsOf(env),
  prefix: env['CONTEXT_S3_PREFIX'] ?? CONTEXT_S3_PREFIX,
})
