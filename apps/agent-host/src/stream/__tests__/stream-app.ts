import { Module, type DynamicModule } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import type { AddressInfo } from 'node:net'

import { HealthController } from '../../http/health.controller'
import { StreamUpgradeController } from '../../http/stream-upgrade.controller'
import { STREAM } from '../../host/tokens'
import { StreamGateway } from '../stream.gateway'
import type { SubscriptionPort } from '../subscription-port'
import { StreamService, type StreamServiceArgs } from '../stream-service'
import { StreamWsAdapter } from '../stream-ws-adapter'

export type RunningStream = {
  port: number
  connections(): number
  drain(args: { reconnectAfterMs?: number }): Promise<void>
  stop(): Promise<void>
}

@Module({})
class StreamTestModule {
  static forStream(stream: StreamService): DynamicModule {
    return {
      module: StreamTestModule,
      controllers: [HealthController, StreamUpgradeController],
      providers: [{ provide: STREAM, useValue: stream }, StreamGateway],
    }
  }
}

export type StreamAppArgs = StreamServiceArgs & { subscriptions?: SubscriptionPort }

export const startStreamApp = async (
  args: StreamAppArgs,
  options: { port?: number } = {},
): Promise<RunningStream> => {
  const stream = new StreamService(args)
  if (args.subscriptions !== undefined) stream.start({ subscriptions: args.subscriptions })
  const app = await NestFactory.create<NestExpressApplication>(StreamTestModule.forStream(stream), {
    logger: false,
  })
  app.useWebSocketAdapter(new StreamWsAdapter(app, (input) => stream.refusal(input)))
  await app.listen(options.port ?? 0)
  const server: { address(): AddressInfo | string | null } = app.getHttpServer()
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the stream app has no port')
  return {
    port: address.port,
    connections: () => stream.connections(),
    drain: (drainArgs) => stream.drain(drainArgs),
    stop: async () => {
      await app.close()
    },
  }
}
