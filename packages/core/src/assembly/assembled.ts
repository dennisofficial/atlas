import type { EventRef } from '../events/envelope'
import type { Message } from '../message/message'
import type { ProviderOptions } from '../provider'

export type SystemBlockPart = { id: string; chars: number }

export type SystemBlock = {
  text: string
  source?: string | undefined
  providerOptions?: ProviderOptions | undefined
  parts?: readonly SystemBlockPart[] | undefined
}

/** `volatile` marks a block rebuilt fresh every step, which no cache entry can reuse. */
export type AssembledMessage = { message: Message; origin: EventRef; volatile?: true | undefined }

export type Assembled = {
  system: readonly SystemBlock[]
  messages: readonly AssembledMessage[]
  requestOptions?: ProviderOptions | undefined
}
