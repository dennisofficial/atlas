import { z } from 'zod'

import { cloudRequest } from './cloud-transport'

const memoryBundleSchema = z.object({ bundle: z.string().nullable() })

export class UserContextClient {
  private readonly url: string
  private readonly token: string
  private readonly clientVersion: string
  private readonly fetchFn: typeof fetch

  constructor(args: {
    url: string
    token: string
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
  }) {
    this.url = args.url.replace(/\/+$/, '')
    this.token = args.token
    this.clientVersion = args.clientVersion ?? 'dev'
    this.fetchFn = args.fetchFn ?? fetch
  }

  async readMemoryBundle(): Promise<string | null> {
    const body = await this.request({ method: 'GET', path: '/v1/user-context/memory' })
    return memoryBundleSchema.parse(body).bundle
  }

  async writeMemoryBundle(bundle: string): Promise<void> {
    await this.request({ method: 'PUT', path: '/v1/user-context/memory', body: { bundle } })
  }

  private request(args: { method: string; path: string; body?: unknown }): Promise<unknown> {
    return cloudRequest({
      url: this.url,
      token: this.token,
      clientVersion: this.clientVersion,
      fetchFn: this.fetchFn,
      method: args.method,
      path: args.path,
      ...(args.body === undefined ? {} : { body: args.body }),
    })
  }
}
