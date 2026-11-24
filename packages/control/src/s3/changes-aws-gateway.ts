import {
  DeleteObjectsCommand,
  type DeleteObjectsCommandOutput,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  type PutObjectCommandOutput,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import type { ChangesS3Settings } from './changes-settings'

export interface ChangesS3Gateway {
  list(command: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput>
  put(command: PutObjectCommand): Promise<PutObjectCommandOutput>
  read(command: GetObjectCommand): Promise<GetObjectCommandOutput>
  remove(command: DeleteObjectsCommand): Promise<DeleteObjectsCommandOutput>
  signGet(args: { command: GetObjectCommand; ttlMs: number }): Promise<string>
  signPut(args: { command: PutObjectCommand; ttlMs: number }): Promise<string>
  head(command: HeadObjectCommand): Promise<boolean>
}

const secondsOf = (ttlMs: number): number => Math.max(1, Math.floor(ttlMs / 1000))

export class ChangesAwsGateway implements ChangesS3Gateway {
  private readonly client: S3Client

  constructor(args: { settings: ChangesS3Settings }) {
    this.client = new S3Client({
      region: args.settings.region,
      endpoint: args.settings.endpoint,
      credentials: {
        accessKeyId: args.settings.accessKeyId,
        secretAccessKey: args.settings.secretAccessKey,
      },
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }

  list(command: ListObjectsV2Command): Promise<ListObjectsV2CommandOutput> {
    return this.client.send(command)
  }

  put(command: PutObjectCommand): Promise<PutObjectCommandOutput> {
    return this.client.send(command)
  }

  read(command: GetObjectCommand): Promise<GetObjectCommandOutput> {
    return this.client.send(command)
  }

  remove(command: DeleteObjectsCommand): Promise<DeleteObjectsCommandOutput> {
    return this.client.send(command)
  }

  signGet(args: { command: GetObjectCommand; ttlMs: number }): Promise<string> {
    return getSignedUrl(this.client, args.command, { expiresIn: secondsOf(args.ttlMs) })
  }

  signPut(args: { command: PutObjectCommand; ttlMs: number }): Promise<string> {
    return getSignedUrl(this.client, args.command, { expiresIn: secondsOf(args.ttlMs) })
  }

  async head(command: HeadObjectCommand): Promise<boolean> {
    try {
      await this.client.send(command)
      return true
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        (error.$metadata.httpStatusCode === 404 || error.name === 'NotFound')
      ) {
        return false
      }
      throw error
    }
  }
}
