import { ServiceUnavailableException } from '@nestjs/common'
import { type ChangeBlobRow, ChangeContentStore } from '@dltech/atlas-control'
import {
  ChangeStorageMissingError,
  changesSettingsOf,
  S3ChangeContentStore as CoreS3ChangeContentStore,
} from '@dltech/atlas-control/s3'
import { EnvService } from '../../_core/config/env/env.service'

const SETTING_KEYS = [
  'CHANGES_S3_BUCKET',
  'CHANGES_S3_PREFIX',
  'ARTIFACT_S3_BUCKET',
  'ARTIFACT_S3_ENDPOINT',
  'ARTIFACT_S3_REGION',
  'ARTIFACT_S3_ACCESS_KEY_ID',
  'ARTIFACT_S3_SECRET_ACCESS_KEY',
] as const

const textOf = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

export const changesEnvOf = (env: EnvService): Record<string, string | undefined> =>
  Object.fromEntries(SETTING_KEYS.map((key) => [key, textOf(env.get(key))]))

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

export class S3ChangeContentStore extends ChangeContentStore {
  private readonly core: CoreS3ChangeContentStore

  constructor(args: { env: EnvService }) {
    super()
    this.core = new CoreS3ChangeContentStore({
      settings: () => changesSettingsOf(changesEnvOf(args.env)),
    })
  }

  put(args: { hash: string; bytes: Uint8Array }): Promise<void> {
    return translated(() => this.core.put(args))
  }

  read(args: { hash: string }): Promise<Uint8Array | null> {
    return translated(() => this.core.read(args))
  }

  presignGet(args: { hash: string; ttlMs: number }): Promise<string> {
    return translated(() => this.core.presignGet(args))
  }

  removing(hashes: readonly string[]): Promise<void> {
    return translated(() => this.core.removing(hashes))
  }

  list(): Promise<readonly ChangeBlobRow[]> {
    return translated(() => this.core.list())
  }
}
