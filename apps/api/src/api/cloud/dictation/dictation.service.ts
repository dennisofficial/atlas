import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { DICTATION_MODEL, type DictationTokenReply } from '@dltech/atlas-wire'

export const DICTATION_TOKEN_MINTER = Symbol('DICTATION_TOKEN_MINTER')

export interface IMintedDictationToken {
  token: string
  url: string
}

export type DictationTokenMinter = (args: { model: string }) => Promise<IMintedDictationToken>

export const dictationUnavailableMessageOf = (error: unknown): string =>
  error instanceof Error && error.message !== ''
    ? `Dictation is unavailable: ${error.message}`
    : 'Dictation is unavailable.'

@Injectable()
export class DictationService {
  constructor(@Inject(DICTATION_TOKEN_MINTER) private readonly mint: DictationTokenMinter) {}

  async token(): Promise<DictationTokenReply> {
    try {
      const { token, url } = await this.mint({ model: DICTATION_MODEL })
      return { token, url, model: DICTATION_MODEL }
    } catch (error) {
      throw new ServiceUnavailableException(dictationUnavailableMessageOf(error))
    }
  }
}
