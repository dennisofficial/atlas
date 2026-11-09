import type { Db } from '@dltech/atlas-db'
import { VercelMediaStore } from '@dltech/atlas-media'

import type { AgentHostEnv } from '../config/env'
import type { SecretCipher } from '../config/secret-cipher'
import { MediaSigner } from '../media/media-signer'
import { PgMediaSigningWindows } from '../media/pg-media-signing-windows'

export type MediaSignerSourceArgs = {
  env: AgentHostEnv
  db: Db
  cipher: SecretCipher
}

export class MediaSignerSource {
  readonly signer: MediaSigner | undefined

  constructor(args: MediaSignerSourceArgs) {
    const token = args.env.mediaBlobToken
    this.signer =
      token === null
        ? undefined
        : new MediaSigner({
            store: new VercelMediaStore({ token }),
            windows: new PgMediaSigningWindows(args.db),
            cipher: args.cipher,
            now: () => Date.now(),
          })
  }
}
