import { createGateway } from '@ai-sdk/gateway'
import { Module } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { DictationRouter } from './dictation.router'
import {
  DICTATION_TOKEN_MINTER,
  DictationService,
  type DictationTokenMinter,
} from './dictation.service'

const gatewayMinterOf = ({ apiKey }: { apiKey: string | undefined }): DictationTokenMinter => {
  if (apiKey === undefined) {
    return async () => {
      throw new Error('AI_GATEWAY_API_KEY is not set')
    }
  }
  const gateway = createGateway({ apiKey })
  return (args) => gateway.experimental_transcription.getToken(args)
}

@Module({
  providers: [
    DictationRouter,
    DictationService,
    {
      provide: DICTATION_TOKEN_MINTER,
      inject: [EnvService],
      useFactory: (env: EnvService) => gatewayMinterOf({ apiKey: env.get('AI_GATEWAY_API_KEY') }),
    },
  ],
})
export class DictationModule {}
