import type { INestApplicationContext } from '@nestjs/common'
import { WsAdapter } from '@nestjs/platform-ws'
import type { IncomingMessage } from 'node:http'

import { STREAM } from '../host/tokens'
import type { StreamRefusal, StreamService } from './stream-service'

type UpgradeInfo = { req: IncomingMessage }

type VerifyUpgrade = (allowed: boolean, status?: number, message?: string) => void

export type StreamRefusalOf = (args: { origin: string | undefined }) => StreamRefusal | undefined

export class StreamWsAdapter extends WsAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly refusalOf: StreamRefusalOf,
  ) {
    super(app)
  }

  override create(port: number, options: Record<string, unknown> = {}): unknown {
    return super.create(port, {
      ...options,
      verifyClient: (info: UpgradeInfo, verify: VerifyUpgrade): void => {
        const refusal = this.refusalOf({ origin: info.req.headers.origin })
        if (refusal === undefined) verify(true)
        else verify(false, refusal.status, refusal.message)
      },
    })
  }
}

export const createStreamWsAdapter = (app: INestApplicationContext): StreamWsAdapter => {
  const stream = app.get<StreamService>(STREAM)
  return new StreamWsAdapter(app, (input) => stream.refusal(input))
}
