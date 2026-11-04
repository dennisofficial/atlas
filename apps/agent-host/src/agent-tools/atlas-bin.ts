import { realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { atlasHomeFrom } from '@dltech/atlas-core'

export const LOGIN_ENV_MARKER = 'ATLAS_RESOLVE_LOGIN_ENV'

const temporaryRoots = (): readonly string[] => {
  const spelled = tmpdir()
  try {
    return [spelled, realpathSync(spelled)]
  } catch {
    return [spelled]
  }
}

export const atlasBinDirectory = (): string =>
  join(atlasHomeFrom({ env: process.env, home: homedir(), tempDirs: temporaryRoots() }), 'bin')
