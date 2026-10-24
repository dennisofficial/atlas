import type { ApiClient } from '@dltech/atlas-api-router'
import { sshSigningKeyStatusSchema, type SshSigningKeyStatus } from '@dltech/atlas-wire'

import { cloudCall, createHarnessApiClient } from './api-trpc-client'
import { CloudError } from './cloud-transport'

const malformed = (procedure: string): CloudError =>
  new CloudError({
    status: 502,
    message: `The Atlas Cloud API answered ${procedure} with a body that is not an ssh signing key status.`,
  })

const parseStatus = (args: { body: unknown; procedure: string }): SshSigningKeyStatus => {
  const parsed = sshSigningKeyStatusSchema.safeParse(args.body)
  if (!parsed.success) throw malformed(args.procedure)
  return parsed.data
}

export class SigningKeyClient {
  private readonly api: ApiClient

  constructor(args: {
    url: string
    token: string
    clientVersion?: string | undefined
    fetchFn?: typeof fetch | undefined
    sleep?: ((ms: number) => Promise<void>) | undefined
  }) {
    this.api = createHarnessApiClient({
      url: args.url,
      token: args.token,
      clientVersion: args.clientVersion ?? 'dev',
      fetchFn: args.fetchFn ?? fetch,
      sleep: args.sleep,
    })
  }

  async status(): Promise<SshSigningKeyStatus> {
    const body = await cloudCall(this.api.sshSigningKey.status.query())
    return parseStatus({ body, procedure: 'sshSigningKey.status' })
  }

  async register(args: { privateKey: string }): Promise<SshSigningKeyStatus> {
    const body = await cloudCall(this.api.sshSigningKey.register.mutate(args))
    return parseStatus({ body, procedure: 'sshSigningKey.register' })
  }

  async rotate(args: { privateKey: string }): Promise<SshSigningKeyStatus> {
    const body = await cloudCall(this.api.sshSigningKey.rotate.mutate(args))
    return parseStatus({ body, procedure: 'sshSigningKey.rotate' })
  }

  async revoke(): Promise<void> {
    await cloudCall(this.api.sshSigningKey.revoke.mutate())
  }
}
