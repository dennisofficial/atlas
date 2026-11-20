export type Agent37UsageInstance = {
  id: string
  compute_micros: number
  awake_minutes: number
  total_micros: number
}

export type Agent37Usage = {
  from: string
  to: string
  instances?: Agent37UsageInstance[] | undefined
}

export type Agent37InstanceEvent = { type: string; at: number }

export type Agent37InstanceEvents = { from: string; to: string; events: Agent37InstanceEvent[] }

export type Agent37UsageClient = {
  usage(args: { from: string; to: string }): Promise<Agent37Usage>
  events(args: { id: string; from: string; to: string }): Promise<Agent37InstanceEvents>
}

export const agent37UsageClient = (
  call: (path: string) => Promise<unknown>,
): Agent37UsageClient => ({
  // https://www.agent37.com/docs/agents-api/billing — `from` and `to` are UTC days, and the
  // `instances` breakdown is what a reconcile meters each sandbox's runs from.
  usage: ({ from, to }) => call(`/v1/usage?from=${from}&to=${to}`) as Promise<Agent37Usage>,
  events: async ({ id, from, to }) => {
    const answer = (await call(
      `/v1/instances/${id}/events?from=${from}&to=${to}`,
    )) as Agent37InstanceEvents
    return { ...answer, events: answer.events ?? [] }
  },
})
