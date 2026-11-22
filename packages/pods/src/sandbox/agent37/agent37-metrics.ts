export type Agent37MetricSample = readonly [at: number, value: number]

export type Agent37MetricsSeries = {
  cpu_cores?: readonly Agent37MetricSample[] | undefined
  memory_bytes?: readonly Agent37MetricSample[] | undefined
  disk_bytes?: readonly Agent37MetricSample[] | undefined
}

export type Agent37MetricsLimits = { cpu_cores: number; memory_bytes: number; disk_bytes: number }

export type Agent37Metrics = {
  series: Agent37MetricsSeries
  limits: Agent37MetricsLimits
  hours: number
  step_seconds: number
  fetched_at: number
}

export type Agent37MetricsClient = {
  metrics(args: { id: string; hours: number }): Promise<Agent37Metrics>
}

export const agent37MetricsClient = (
  call: (path: string) => Promise<unknown>,
): Agent37MetricsClient => ({
  // https://www.agent37.com/docs/agents-api/metrics.md — `series.disk_bytes` is what the data
  // volume holds and answers empty for the first minutes of an instance, so a reader treats an
  // empty series as unknown rather than as an empty disk.
  metrics: ({ id, hours }) =>
    call(`/v1/instances/${id}/metrics?hours=${hours}`) as Promise<Agent37Metrics>,
})
