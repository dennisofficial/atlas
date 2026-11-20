export type Agent37UsageReader = {
  usage(args: { from: string; to: string }): Promise<{
    instances?: readonly { id: string; compute_micros: number }[] | undefined
  }>
}

export type Agent37Meter = (params: {
  sandboxInstanceId: string
  computeMicros: number
  from: number
  to: number
}) => Promise<number>

export type Agent37UsageReconcileSummary = { instances: number; meteredRuns: number }

const utcDayOf = (at: Date): string => at.toISOString().slice(0, 10)

const dayStartOf = (day: string): number => Date.parse(`${day}T00:00:00Z`)

export const reconcileAgent37Usage = async (args: {
  usage: Agent37UsageReader
  meter: Agent37Meter
  now: Date
  log: (line: string) => void
}): Promise<Agent37UsageReconcileSummary> => {
  const today = utcDayOf(args.now)
  const yesterday = utcDayOf(new Date(args.now.getTime() - 24 * 60 * 60_000))
  const windowStart = dayStartOf(yesterday)
  const windowEnd = args.now.getTime()
  const report = await args.usage.usage({ from: yesterday, to: today })
  const instances = report.instances ?? []
  let meteredRuns = 0
  for (const instance of instances) {
    if (instance.compute_micros <= 0) continue
    meteredRuns += await args.meter({
      sandboxInstanceId: instance.id,
      computeMicros: instance.compute_micros,
      from: windowStart,
      to: windowEnd,
    })
  }
  args.log(
    `agent37 usage ${yesterday}..${today}: ${instances.length} instances, metered ${meteredRuns} runs`,
  )
  return { instances: instances.length, meteredRuns }
}
