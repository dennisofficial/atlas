import { AgentFileSystemPort, EventLogPort, IdPort, LogPort, ProcessPort } from '@dltech/atlas-core'

import { withEventsAppendedPublishing } from '../channel/events-appended-log'
import { instanceCachingFactory, registeredPortToken, type DependencyContainer } from '../container/injection'
import { DeltaChannelToken } from '../container/tokens'
import { ShellRegistryPort } from '../shells/port'

import { deliverOperatorInput } from './deliver'
import { InProcessOperatorInput } from './registry'
import { OperatorInputPort } from './port'

export function registerOperatorInput({ container }: { container: DependencyContainer }): void {
  container.register(registeredPortToken(OperatorInputPort), {
    useFactory: instanceCachingFactory((resolver) => {
      const channel = () =>
        container.isRegistered(DeltaChannelToken, true) ? container.resolve(DeltaChannelToken) : undefined
      const onListenerError = (cause: unknown) => resolver.resolve(registeredPortToken(LogPort)).warn({
        source: 'operator-input.publication',
        message: 'a channel listener failed during operator input publication',
        error: cause instanceof Error ? cause.message : String(cause),
      })
      return new InProcessOperatorInput({
        log: withEventsAppendedPublishing({ log: resolver.resolve(registeredPortToken(EventLogPort)), channel, onListenerError }),
        onListenerError,
        ids: resolver.resolve(registeredPortToken(IdPort)),
        channel,
        deliver: (args) => deliverOperatorInput({
          ...args,
          files: container.resolve(registeredPortToken(AgentFileSystemPort)),
          processes: container.resolve(registeredPortToken(ProcessPort)),
        }),
        writeShellInput: (args) => container.resolve(registeredPortToken(ShellRegistryPort)).writeInput(args),
      })
    }),
  })
}
