import { join } from 'node:path'

import { accountHomeOf } from './account/account-file'

export const PASTES_DIRECTORY_NAME = 'pastes'

export const pasteDirectoryOf = (args: {
  env: Record<string, string | undefined>
  home: string
  sessionId: string
}): string =>
  join(accountHomeOf({ env: args.env, home: args.home }), PASTES_DIRECTORY_NAME, args.sessionId)
