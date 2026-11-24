import type { ChangeBlobRow, PresignGetArgs, PresignPutArgs } from '../change-content'
import { ContextContentStore } from '../context-content'
import type { ChangesS3Gateway } from './changes-aws-gateway'
import type { ChangesSettings } from './changes-settings'
import { S3ChangeContentStore } from './s3-change-content-store'

export class S3ContextContentStore extends ContextContentStore {
  private readonly inner: S3ChangeContentStore

  constructor(args: { settings: () => ChangesSettings; gateway?: ChangesS3Gateway }) {
    super()
    this.inner = new S3ChangeContentStore(args)
  }

  put(args: { hash: string; bytes: Uint8Array }): Promise<void> {
    return this.inner.put(args)
  }

  read(args: { hash: string }): Promise<Uint8Array | null> {
    return this.inner.read(args)
  }

  presignGet(args: PresignGetArgs): Promise<string> {
    return this.inner.presignGet(args)
  }

  presignPut(args: PresignPutArgs): Promise<string> {
    return this.inner.presignPut(args)
  }

  exists(args: { hash: string }): Promise<boolean> {
    return this.inner.exists(args)
  }

  removing(hashes: readonly string[]): Promise<void> {
    return this.inner.removing(hashes)
  }

  list(): Promise<readonly ChangeBlobRow[]> {
    return this.inner.list()
  }
}
