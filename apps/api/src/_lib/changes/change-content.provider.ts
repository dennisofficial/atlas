import { ServiceUnavailableException, type Provider } from '@nestjs/common'
import { type ChangeBlobRow, ChangeContentStore } from '@dltech/atlas-control'
import { EnvService } from '../../_core/config/env/env.service'
import { S3ChangeContentStore } from './s3-change-content-store'

const unavailable = (): never => {
  throw new ServiceUnavailableException('change storage is not configured')
}

export class UnavailableChangeContentStore extends ChangeContentStore {
  put(): Promise<void> {
    return unavailable()
  }

  read(): Promise<Uint8Array | null> {
    return unavailable()
  }

  presignGet(): Promise<string> {
    return unavailable()
  }

  removing(): Promise<void> {
    return unavailable()
  }

  list(): Promise<readonly ChangeBlobRow[]> {
    return unavailable()
  }
}

export const changeContentStoreProvider: Provider = {
  provide: ChangeContentStore,
  inject: [EnvService],
  useFactory: (env: EnvService): ChangeContentStore => {
    const bucket = env.get('CHANGES_S3_BUCKET') ?? env.get('ARTIFACT_S3_BUCKET')
    return bucket ? new S3ChangeContentStore({ env }) : new UnavailableChangeContentStore()
  },
}
