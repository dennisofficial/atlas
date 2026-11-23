import { authProviderOf, checkProviderKey } from '@dltech/atlas-credentials'
import { BadRequestException, Injectable } from '@nestjs/common'

export abstract class ProviderKeyHttp {
  abstract readonly fetch: typeof fetch
}

@Injectable()
export class GlobalProviderKeyHttp implements ProviderKeyHttp {
  readonly fetch: typeof fetch = globalThis.fetch
}

@Injectable()
export class ProviderKeyCheckService {
  constructor(private readonly http: ProviderKeyHttp) {}

  async check(args: { provider: string; apiKey: string }): Promise<void> {
    const provider = authProviderOf(args.provider)
    if (provider === undefined) throw new BadRequestException('unknown provider')
    const result = await checkProviderKey({
      provider,
      apiKey: args.apiKey,
      fetch: this.http.fetch,
    })
    if (!result.ok) throw new BadRequestException(result.detail)
  }
}
