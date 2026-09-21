import { StreamableFile } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { Response } from 'express'
import { SERVE_BINARY_SHA256_HEADER } from './serve-binary'
import { ServeBinaryController } from './serve-binary.controller'

const HASH = 'a'.repeat(64)

const stubResponse = (): Response => {
  const res = { setHeader: vi.fn() }
  return res as unknown as Response
}

describe('ServeBinaryController', () => {
  it('carries the binary\u2019s own sha256 as a response header, ahead of the streamed body', async () => {
    const streamed = new StreamableFile(Buffer.from('binary'))
    const serveBinary = {
      binaryHash: vi.fn(async () => HASH),
      stream: vi.fn(async () => streamed),
    }
    const controller = new ServeBinaryController(
      serveBinary as unknown as ConstructorParameters<typeof ServeBinaryController>[0],
    )
    const res = stubResponse()

    const result = await controller.handleDownload(res)

    expect(res.setHeader).toHaveBeenCalledWith(SERVE_BINARY_SHA256_HEADER, HASH)
    expect(result).toBe(streamed)
  })
})
