import type { INestApplicationContext } from '@nestjs/common'
import { WsAdapter } from '@nestjs/platform-ws'
import type { IncomingMessage } from 'node:http'

import type { StreamRefusal } from './stream-service'

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
