import { ServiceUnavailableException, type Provider } from '@nestjs/common'
import {
  type ChangeBlobRow,
  ContextContentStore,
  type PresignGetArgs,
  type PresignPutArgs,
} from '@dltech/atlas-control'
import {
  ChangeStorageMissingError,
  contextSettingsOf,
  S3ContextContentStore as CoreS3ContextContentStore,
} from '@dltech/atlas-control/s3'
import { EnvService } from '../../_core/config/env/env.service'
import { changesEnvOf } from './s3-change-content-store'

const translated = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work()
  } catch (error) {
    if (error instanceof ChangeStorageMissingError) {
      throw new ServiceUnavailableException(error.message)
    }
    throw error
  }
}

export class S3ContextContentStore extends ContextContentStore {
  private readonly core: CoreS3ContextContentStore

  constructor(args: { env: EnvService }) {
    super()
    this.core = new CoreS3ContextContentStore({
      settings: () => contextSettingsOf(changesEnvOf(args.env)),
    })
  }
  put(args: { hash: string; bytes: Uint8Array }): Promise<void> {
    return translated(() => this.core.put(args))
  }

  read(args: { hash: string }): Promise<Uint8Array | null> {
    return translated(() => this.core.read(args))
  }

  presignGet(args: PresignGetArgs): Promise<string> {
    return translated(() => this.core.presignGet(args))
  }

  presignPut(args: PresignPutArgs): Promise<string> {
    return translated(() => this.core.presignPut(args))
  }

  exists(args: { hash: string }): Promise<boolean> {
    return translated(() => this.core.exists(args))
  }

  removing(hashes: readonly string[]): Promise<void> {
    return translated(() => this.core.removing(hashes))
  }

  list(): Promise<readonly ChangeBlobRow[]> {
    return translated(() => this.core.list())
  }
}

const unavailable = (): never => {
  throw new ServiceUnavailableException('context storage is not configured')
}

export class UnavailableContextContentStore extends ContextContentStore {
  put(): Promise<void> {
    return unavailable()
  }

  read(): Promise<Uint8Array | null> {
    return unavailable()
  }

  presignGet(): Promise<string> {
    return unavailable()
  }

  presignPut(): Promise<string> {
    return unavailable()
  }

  exists(): Promise<boolean> {
    return unavailable()
  }

  removing(): Promise<void> {
    return unavailable()
  }

  list(): Promise<readonly ChangeBlobRow[]> {
    return unavailable()
  }
}

export const contextContentStoreOf = (env: EnvService): ContextContentStore => {
  const bucket = env.get('CHANGES_S3_BUCKET') ?? env.get('ARTIFACT_S3_BUCKET')
  return bucket ? new S3ContextContentStore({ env }) : new UnavailableContextContentStore()
}

export const contextContentStoreProvider: Provider = {
  provide: ContextContentStore,
  inject: [EnvService],
  useFactory: contextContentStoreOf,
}
