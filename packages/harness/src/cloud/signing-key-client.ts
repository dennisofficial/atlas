import { sshSigningKeyStatusSchema, type SshSigningKeyStatus } from '@dltech/atlas-wire'

import { CloudError, CloudTransport } from './cloud-transport'

const SIGNING_KEY_PATH = '/v1/ssh-signing-key'

const malformed = (path: string): CloudError =>
  new CloudError({
    status: 502,
    message: `The Atlas Cloud API answered ${path} with a body that is not an ssh signing key status.`,
  })

export class SigningKeyClient {
  private readonly transport: CloudTransport

  constructor(args: {
    url: string
    token: string
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
  }) {
    this.transport = new CloudTransport(args)
  }

  async status(): Promise<SshSigningKeyStatus> {
    const body = await this.transport.request({ method: 'GET', path: `${SIGNING_KEY_PATH}/status` })
    return this.parseStatus({ body, path: `${SIGNING_KEY_PATH}/status` })
  }

  async register(args: { privateKey: string }): Promise<SshSigningKeyStatus> {
    const body = await this.transport.request({
      method: 'POST',
      path: SIGNING_KEY_PATH,
      body: { privateKey: args.privateKey },
      retry: false,
    })
    return this.parseStatus({ body, path: SIGNING_KEY_PATH })
  }

  async rotate(args: { privateKey: string }): Promise<SshSigningKeyStatus> {
    const path = `${SIGNING_KEY_PATH}/rotate`
    const body = await this.transport.request({
      method: 'POST',
      path,
      body: { privateKey: args.privateKey },
      retry: false,
    })
    return this.parseStatus({ body, path })
  }

  async revoke(): Promise<void> {
    await this.transport.request({ method: 'DELETE', path: SIGNING_KEY_PATH, retry: false })
  }

  private parseStatus(args: { body: unknown; path: string }): SshSigningKeyStatus {
    const parsed = sshSigningKeyStatusSchema.safeParse(args.body)
    if (!parsed.success) throw malformed(args.path)
    return parsed.data
  }
}
