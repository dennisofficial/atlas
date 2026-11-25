import { ServiceUnavailableException, type Provider } from '@nestjs/common'
import { MediaStore, VercelMediaStore, type ReadDelegation } from '@dltech/atlas-media'
import { EnvService } from '../../../_core/config/env/env.service'

const notConfigured = (): never => {
  throw new ServiceUnavailableException('image storage is not configured')
}

export class UnconfiguredMediaStore extends MediaStore {
  issueReadDelegation(): Promise<ReadDelegation> {
    return notConfigured()
  }

  presignGet(): Promise<string> {
    return notConfigured()
  }

  presignPut(): Promise<string> {
    return notConfigured()
  }

  head(): Promise<{ size: number } | null> {
    return notConfigured()
  }

  read(): Promise<Uint8Array | null> {
    return notConfigured()
  }

  delete(): Promise<void> {
    return notConfigured()
  }
}

export const mediaStoreProvider: Provider = {
  provide: MediaStore,
  inject: [EnvService],
  useFactory: (env: EnvService): MediaStore => {
    const token = env.get('BLOB_READ_WRITE_TOKEN')
    return token ? new VercelMediaStore({ token }) : new UnconfiguredMediaStore()
  },
}
