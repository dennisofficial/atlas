import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3'

import { type ChangeBlobRow, ChangeContentStore, changeBlobKey } from '../change-content'
import { ChangesAwsGateway, type ChangesS3Gateway } from './changes-aws-gateway'
import type { ChangesSettings } from './changes-settings'

const REMOVE_BATCH_SIZE = 1000

const LIST_PAGE_SIZE = 1000

const HASH_IN_KEY = /\/sha256\/[0-9a-f]{2}\/([0-9a-f]{64})$/

const isMissing = (error: unknown): boolean =>
  error instanceof S3ServiceException &&
  (error.$metadata.httpStatusCode === 404 || error.name === 'NoSuchKey')

export class S3ChangeContentStore extends ChangeContentStore {
  private readonly settings: () => ChangesSettings
  private readonly injected: ChangesS3Gateway | null
  private resolved: { gateway: ChangesS3Gateway; changes: ChangesSettings } | null = null

  constructor(args: { settings: () => ChangesSettings; gateway?: ChangesS3Gateway }) {
    super()
    this.settings = args.settings
    this.injected = args.gateway ?? null
  }

  private s3(): { gateway: ChangesS3Gateway; changes: ChangesSettings } {
    if (this.resolved === null) {
      const changes = this.settings()
      this.resolved = {
        changes,
        gateway: this.injected ?? new ChangesAwsGateway({ settings: changes.settings }),
      }
    }
    return this.resolved
  }

  private keyOf(hash: string): { bucket: string; key: string } {
    const { changes } = this.s3()
    return { bucket: changes.settings.bucket, key: changeBlobKey({ prefix: changes.prefix, hash }) }
  }

  async put(args: { hash: string; bytes: Uint8Array }): Promise<void> {
    const { gateway } = this.s3()
    const { bucket, key } = this.keyOf(args.hash)
    await gateway.put(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: args.bytes,
        ContentType: 'application/octet-stream',
      }),
    )
  }

  async read(args: { hash: string }): Promise<Uint8Array | null> {
    const { gateway } = this.s3()
    const { bucket, key } = this.keyOf(args.hash)
    try {
      const found = await gateway.read(new GetObjectCommand({ Bucket: bucket, Key: key }))
      if (found.Body === undefined) return null
      return new Uint8Array(await found.Body.transformToByteArray())
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async presignGet(args: { hash: string; ttlMs: number }): Promise<string> {
    const { gateway } = this.s3()
    const { bucket, key } = this.keyOf(args.hash)
    return gateway.signGet({
      command: new GetObjectCommand({ Bucket: bucket, Key: key }),
      ttlMs: args.ttlMs,
    })
  }

  async removing(hashes: readonly string[]): Promise<void> {
    if (hashes.length === 0) return
    const { gateway } = this.s3()
    const { changes } = this.s3()
    for (let start = 0; start < hashes.length; start += REMOVE_BATCH_SIZE) {
      const batch = hashes.slice(start, start + REMOVE_BATCH_SIZE)
      await gateway.remove(
        new DeleteObjectsCommand({
          Bucket: changes.settings.bucket,
          Delete: { Objects: batch.map((hash) => ({ Key: this.keyOf(hash).key })), Quiet: true },
        }),
      )
    }
  }

  async list(): Promise<readonly ChangeBlobRow[]> {
    const { gateway, changes } = this.s3()
    const found: ChangeBlobRow[] = []
    let token: string | undefined
    for (;;) {
      const page = await gateway.list(
        new ListObjectsV2Command({
          Bucket: changes.settings.bucket,
          Prefix: `${changes.prefix}/sha256/`,
          MaxKeys: LIST_PAGE_SIZE,
          ...(token === undefined ? {} : { ContinuationToken: token }),
        }),
      )
      for (const object of page.Contents ?? []) {
        const match = object.Key === undefined ? null : HASH_IN_KEY.exec(object.Key)
        if (match === null || match[1] === undefined) continue
        found.push({
          hash: match[1],
          size: object.Size ?? 0,
          createdAt: object.LastModified?.getTime() ?? 0,
        })
      }
      if (page.IsTruncated !== true || page.NextContinuationToken === undefined) return found
      token = page.NextContinuationToken
    }
  }
}
