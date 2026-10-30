import { Injectable } from '@nestjs/common'
import type { ProviderFetch } from '@dltech/atlas-harness/provider-oauth'

export abstract class ProviderHttp {
  abstract readonly fetch: ProviderFetch
  abstract now(): number
}

@Injectable()
export class GlobalProviderHttp implements ProviderHttp {
  readonly fetch: ProviderFetch = (input, init) => globalThis.fetch(input, init)
  now(): number {
    return Date.now()
  }
}
