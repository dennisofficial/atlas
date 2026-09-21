import { z } from 'zod'

import { CloudTransport } from './cloud-transport'

const memoryBundleSchema = z.object({ bundle: z.string().nullable() })

const GZIP_ACCEPT = 'application/gzip'

export class UserContextClient {
  private readonly transport: CloudTransport

  constructor(args: {
    url: string
    token: string
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
  }) {
    this.transport = new CloudTransport(args)
  }

  async readMemoryBundle(): Promise<string | null> {
    const body = await this.request({ method: 'GET', path: '/v1/user-context/memory' })
    return memoryBundleSchema.parse(body).bundle
  }

  async writeMemoryBundle(bundle: string): Promise<void> {
    await this.request({ method: 'PUT', path: '/v1/user-context/memory', body: { bundle } })
  }

  /** `null` when nothing has ever synced as an archive \u2014 the caller falls back to the JSON bundle. */
  async readMemoryArchive(): Promise<Uint8Array | null> {
    return this.transport.rawRequest({
      method: 'GET',
      path: '/v1/user-context/memory',
      accept: GZIP_ACCEPT,
      allowMissing: true,
    })
  }

  async writeMemoryArchive(archive: Uint8Array): Promise<void> {
    await this.transport.rawRequest({
      method: 'PUT',
      path: '/v1/user-context/memory',
      body: archive,
      contentType: GZIP_ACCEPT,
    })
  }

  private request(args: { method: string; path: string; body?: unknown }): Promise<unknown> {
    return this.transport.request(args)
  }
}
