import { AgentFileSystemPort, EventLogPort, IdPort, LogPort, ProcessPort } from '@dltech/atlas-core'

import { withEventsAppendedPublishing } from '../channel/events-appended-log'
import { instanceCachingFactory, portToken, type DependencyContainer } from '../container/injection'
import { DeltaChannelToken } from '../container/tokens'

import { deliverOperatorInput } from './deliver'
import { InProcessOperatorInput } from './registry'
import { OperatorInputPort } from './port'

export function registerOperatorInput({ container }: { container: DependencyContainer }): void {
  container.register(portToken(OperatorInputPort), {
    useFactory: instanceCachingFactory((resolver) => {
      const channel = () =>
        container.isRegistered(DeltaChannelToken, true) ? container.resolve(DeltaChannelToken) : undefined
      const onListenerError = (cause: unknown) => resolver.resolve(portToken(LogPort)).warn({
        source: 'operator-input.publication',
        message: 'a channel listener failed during operator input publication',
        error: cause instanceof Error ? cause.message : String(cause),
      })
      return new InProcessOperatorInput({
        log: withEventsAppendedPublishing({ log: resolver.resolve(portToken(EventLogPort)), channel, onListenerError }),
        onListenerError,
        ids: resolver.resolve(portToken(IdPort)),
        channel,
        deliver: (args) => deliverOperatorInput({
          ...args,
          files: container.resolve(portToken(AgentFileSystemPort)),
          processes: container.resolve(portToken(ProcessPort)),
        }),
      })
    }),
  })
}
