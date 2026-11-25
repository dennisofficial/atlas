import type { Db } from '@dltech/atlas-db'
import { VercelMediaStore, type MediaStore } from '@dltech/atlas-media'

import type { AgentHostEnv } from '../config/env'
import type { SecretCipher } from '@dltech/atlas-pods/config/secret-cipher'
import { MediaSigner } from '../media/media-signer'
import { PgMediaSigningWindows } from '../media/pg-media-signing-windows'

export type MediaSignerSourceArgs = {
  env: AgentHostEnv
  db: Db
  cipher: SecretCipher
}

export class MediaSignerSource {
  readonly signer: MediaSigner | undefined
  readonly store: MediaStore | undefined

  constructor(args: MediaSignerSourceArgs) {
    const token = args.env.mediaBlobToken
    const store = token === null ? undefined : new VercelMediaStore({ token })
    this.store = store
    this.signer =
      store === undefined
        ? undefined
        : new MediaSigner({
            store,
            windows: new PgMediaSigningWindows(args.db),
            cipher: args.cipher,
            now: () => Date.now(),
          })
  }
}
