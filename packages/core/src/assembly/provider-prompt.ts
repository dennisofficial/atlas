import type { Message } from '../message/message'
import type { ProviderIdentity, ProviderOptions } from '../provider'
import type { SystemBlock } from './assembled'

export type ProviderPrompt = {
  instructions: readonly SystemBlock[]
  messages: readonly Message[]
  provider: ProviderIdentity
  requestOptions?: ProviderOptions | undefined
}
