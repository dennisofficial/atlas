import { systemContext } from '../../context/envelope'
import { shellLabel } from '../../shells/label'
import { defineRule, type Rule } from '../rule'
import { appendedAtTail } from './tail-block'

export type RunningService = {
  serviceId: string
  command: string
  description?: string | undefined
  logPath: string
}

export type RunningServicesSource = () => readonly RunningService[]

const lineFor = (service: RunningService): string =>
  `${service.serviceId}  ${shellLabel(service)}  log: ${service.logPath}`

export function runningServicesReminder(services: readonly RunningService[]): string {
  return systemContext({ slot: 'running-services', key: 'roster', content: 
    [
      'These services are running across the whole session:',
      services.map(lineFor).join('\n'),
      'Services keep running as infrastructure you work against: an exit is not a completion. The list is shared by every thread, but an exit notice goes only to the thread that started the service, so another thread is not told when one exits. Check health in its log file or at its endpoint. For stopping one, service_stop({ id }) applies when that tool is available.',
    ].join('\n\n'),
  })
}

export function runningServicesBlock({
  runningServices,
}: {
  runningServices: RunningServicesSource
}): Rule {
  return defineRule({
    name: 'runningServicesBlock',
    apply: (input, ctx) => {
      const services = runningServices()
      if (services.length === 0) return input

      return appendedAtTail({ input, ctx, text: runningServicesReminder(services) })
    },
  })
}
