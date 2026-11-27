import { ServiceUnavailableException } from '@nestjs/common'
import { DICTATION_MODEL, dictationTokenReplySchema } from '@dltech/atlas-wire'
import { describe, expect, it } from 'bun:test'
import {
  DictationService,
  dictationUnavailableMessageOf,
  type DictationTokenMinter,
} from './dictation.service'

const MINTED = {
  token: 'vcst_abc',
  url: 'wss://ai-gateway.vercel.sh/v4/ai/transcription-model?ai-model-id=microsoft%2Fmai',
}

const recordingMinter = (
  calls: Array<{ model: string }>,
  reply: { token: string; url: string } = MINTED,
): DictationTokenMinter => {
  return async (args) => {
    calls.push(args)
    return reply
  }
}

describe('DictationService', () => {
  it('mints one token for the streaming MAI model', async () => {
    const calls: Array<{ model: string }> = []
    const service = new DictationService(recordingMinter(calls))

    const reply = dictationTokenReplySchema.parse(await service.token())

    expect(calls).toEqual([{ model: DICTATION_MODEL }])
    expect(reply).toEqual({ ...MINTED, model: DICTATION_MODEL })
  })

  it('answers service unavailable when minting fails', async () => {
    const service = new DictationService(async () => {
      throw new Error('gateway said no')
    })

    const failure = service.token().catch((error: unknown) => error)

    expect(await failure).toBeInstanceOf(ServiceUnavailableException)
    expect(dictationUnavailableMessageOf(new Error('gateway said no'))).toBe(
      'Dictation is unavailable: gateway said no',
    )
  })

  it('announces an unconfigured gateway without a message', async () => {
    expect(dictationUnavailableMessageOf(undefined)).toBe('Dictation is unavailable.')
  })
})
