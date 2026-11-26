import { EResourceWait, ESpan, spanWith, type TracePort } from '@dltech/atlas-observability'

export type ResourceWait = <T>(args: {
  waitFor: EResourceWait
  resource?: string | undefined
  work: () => Promise<T>
}) => Promise<T>

export const waitingOn = <T>(args: {
  wait: ResourceWait | undefined
  waitFor: EResourceWait
  resource?: string | undefined
  work: () => Promise<T>
}): Promise<T> =>
  args.wait === undefined
    ? args.work()
    : args.wait({ waitFor: args.waitFor, resource: args.resource, work: args.work })

export const spanWaitOf =
  (trace: TracePort | undefined): ResourceWait =>
  (args) =>
    spanWith(trace, {
      name: ESpan.ResourceWait,
      fields: {
        waitFor: args.waitFor,
        ...(args.resource === undefined ? {} : { resource: args.resource }),
      },
      run: args.work,
    })
