import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { Injectable, ServiceUnavailableException, StreamableFile } from '@nestjs/common'
import { EnvService } from '../../_core/config/env/env.service'

export const DEFAULT_SERVE_BINARY_PATH = '/app/atlas-serve'

/** Carries the served binary's own sha256 so the sandbox can verify what it downloaded byte-for-byte. */
export const SERVE_BINARY_SHA256_HEADER = 'x-atlas-serve-sha256'

@Injectable()
export class ServeBinaryService {
  private stampCache: Promise<string> | undefined
  private hashCache: Promise<string> | undefined

  constructor(private readonly env: EnvService) {}

  /** The freshness stamp: the image build's source-hash sidecar, or the binary's own hash in dev. */
  async stamp(): Promise<string> {
    if (this.stampCache === undefined) this.stampCache = this.readStamp()
    return this.stampCache
  }

  /** The binary's own sha256, for integrity — computed once and shared with the stamp's dev fallback. */
  async binaryHash(): Promise<string> {
    if (this.hashCache === undefined) this.hashCache = this.readBinaryHash()
    return this.hashCache
  }

  private async readStamp(): Promise<string> {
    const path = this.binaryPath()
    const stamped = await readFile(`${path}.sha256`, 'utf8').then(
      (content) => content.trim(),
      () => undefined,
    )
    if (stamped !== undefined && stamped.length > 0) return stamped
    return this.binaryHash()
  }

  private async readBinaryHash(): Promise<string> {
    const path = this.binaryPath()
    const binary = await readFile(path).catch(() => undefined)
    if (binary === undefined) throw this.missing(path)
    return createHash('sha256').update(binary).digest('hex')
  }

  async stream(): Promise<StreamableFile> {
    const path = this.binaryPath()
    const present = await stat(path).then(
      () => true,
      () => false,
    )
    if (!present) throw this.missing(path)
    return new StreamableFile(createReadStream(path), { type: 'application/octet-stream' })
  }

  private binaryPath(): string {
    return this.env.get('SANDBOX_SERVE_BINARY') ?? DEFAULT_SERVE_BINARY_PATH
  }

  private missing(path: string): ServiceUnavailableException {
    return new ServiceUnavailableException(`this deployment has no atlas serve binary at ${path}`)
  }
}
