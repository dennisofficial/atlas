import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common'
import type { RequestHandler } from 'express'
import { raw } from 'express'

const GZIP_MEDIA_TYPE = 'application/gzip'

const mediaTypeOf = (header: string): string => header.split(';')[0]?.trim().toLowerCase() ?? ''

export function isGzipContentType(contentType: string | undefined): boolean {
  return contentType !== undefined && mediaTypeOf(contentType) === GZIP_MEDIA_TYPE
}

export function wantsGzipResponse(accept: string | undefined): boolean {
  if (accept === undefined) return false
  return accept.split(',').some((one) => mediaTypeOf(one) === GZIP_MEDIA_TYPE)
}

export function assertGzipContentType(contentType: string | undefined): void {
  if (isGzipContentType(contentType)) return
  throw new UnsupportedMediaTypeException(
    `expected Content-Type: ${GZIP_MEDIA_TYPE}, got ${contentType ?? 'none'}`,
  )
}

export function bufferBodyOf(body: unknown): Buffer {
  if (Buffer.isBuffer(body)) return body
  throw new BadRequestException('expected a raw gzip body')
}

/**
 * Mounted on exactly the two routes that accept a binary archive, never globally — a request
 * whose Content-Type is not `application/gzip` passes through untouched, so the same path can
 * still carry the legacy JSON body (see `UserContextController.handlePut`).
 */
export function contextArchiveRawParser(args: { limitBytes: number }): RequestHandler {
  return raw({ type: GZIP_MEDIA_TYPE, limit: args.limitBytes })
}
