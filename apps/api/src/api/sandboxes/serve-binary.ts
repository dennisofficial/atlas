import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { Injectable, ServiceUnavailableException, StreamableFile } from '@nestjs/common'
import { EnvService } from '../../_core/config/env/env.service'

export const DEFAULT_SERVE_BINARY_PATH = '/app/atlas-serve'

@Injectable()
export class ServeBinaryService {
  private stampCache: Promise<string> | undefined

  constructor(private readonly env: EnvService) {}

  async stamp(): Promise<string> {
    if (this.stampCache === undefined) this.stampCache = this.readStamp()
    return this.stampCache
  }

  private async readStamp(): Promise<string> {
    const path = this.binaryPath()
    const stamped = await readFile(`${path}.sha256`, 'utf8').then(
      (content) => content.trim(),
      () => undefined,
    )
    if (stamped !== undefined && stamped.length > 0) return stamped
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
