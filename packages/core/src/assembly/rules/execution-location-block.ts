import { wrapInSystemReminder } from '../../context/render'
import type { ThreadId } from '../../events/ids'
import { EExecutionLocation } from '../../execution/location'
import { defineRule, type Rule } from '../rule'
import { endsOnCompletedAssistant } from './completed-exchange'
import { appendedAtTail } from './tail-block'

export type ExecutionEnvironment = {
  location: EExecutionLocation
  mounts: readonly string[]
}

export type ExecutionLocationSource = (args: { threadId: ThreadId }) => ExecutionEnvironment

const EXPOSED_SERVICES_LINE =
  'For exposed services, bind to 0.0.0.0, publish the listening port, and give the developer the returned URL.'

const mountsLineOf = (mounts: readonly string[]): string =>
  mounts.length === 0 ? '' : `Additional configured mounts: ${mounts.join(', ')}.`

const factsOf = (environment: ExecutionEnvironment): readonly string[] => {
  if (environment.location === EExecutionLocation.Host) {
    return ['Execution location: host. Bash and file tools run directly on the developer’s machine.']
  }
  if (environment.location === EExecutionLocation.Docker) {
    return [
      'Execution location: Docker container. The harness runs locally; bash and file tools are routed into the container, while MCP servers remain external connections of the harness.',
      'Filesystem access uses the container’s mounted paths.',
      mountsLineOf(environment.mounts),
      EXPOSED_SERVICES_LINE,
    ]
  }
  return [
    'Execution location: cloud. The harness and the execution both run in a Vercel sandbox, and the developer’s terminal is only a client.',
    'The workspace here is a copy of the project, not a live mount of the developer’s machine.',
    EXPOSED_SERVICES_LINE,
  ]
}

export function executionLocationNote(environment: ExecutionEnvironment): string {
  return wrapInSystemReminder(factsOf(environment).filter((line) => line !== '').join(' '))
}

export function executionLocationBlock({
  executionLocation,
}: {
  executionLocation: ExecutionLocationSource
}): Rule {
  return defineRule({
    name: 'executionLocationBlock',
    apply: (input, ctx) => {
      if (endsOnCompletedAssistant({ input, ctx })) return input

      return appendedAtTail({
        input,
        ctx,
        text: executionLocationNote(executionLocation({ threadId: ctx.threadId })),
      })
    },
  })
}
