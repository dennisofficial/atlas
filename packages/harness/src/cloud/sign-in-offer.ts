import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { atlasDirectory } from '../store/paths'

export type SignInOffer = {
  offered(): boolean
  markOffered(): void
}

const MARKER_NAME = 'cloud-sign-in-offered'

export function fileSignInOffer(args?: { directory?: string }): SignInOffer {
  const file = join(args?.directory ?? atlasDirectory(), MARKER_NAME)

  return {
    offered: () => {
      try {
        return readFileSync(file, 'utf8').trim().length > 0
      } catch {
        return false
      }
    },
    markOffered: () => {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, '1\n')
    },
  }
}
