import type { LanguageModelV4 } from '@ai-sdk/provider'
import type { EventLogPort, RunId } from '@dltech/atlas-core'

import { withEventsAppendedPublishing } from '../channel/events-appended-log'
import { registeredPortToken, type DependencyContainer } from '../container/injection'
import { DeltaChannelToken } from '../container/tokens'
import { DiagramRepairPort } from '../diagrams/diagram-repair-port'
import { LocalDiagramRepair } from '../diagrams/local-diagram-repair'

export function bindDiagramRepair(args: {
  container: DependencyContainer
  log: EventLogPort
  model: () => LanguageModelV4 | undefined
  modelId: () => string
  runId: () => RunId
}): void {
  const { container } = args
  container.register(registeredPortToken(DiagramRepairPort), {
    useValue: new LocalDiagramRepair({
      log: withEventsAppendedPublishing({
        log: args.log,
        channel: () =>
          container.isRegistered(DeltaChannelToken, true)
            ? container.resolve(DeltaChannelToken)
            : undefined,
      }),
      model: args.model,
      modelId: args.modelId,
      runId: args.runId,
    }),
  })
}
