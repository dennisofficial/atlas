export type ReplacedService = { serviceId: string; replaces?: string | undefined }

export const currentServiceIdOf = (args: {
  rows: readonly ReplacedService[]
  serviceId: string
}): string => {
  let current = args.serviceId
  for (let steps = 0; steps < args.rows.length; steps += 1) {
    const next = args.rows.findLast((row) => row.replaces === current)
    if (next === undefined) return current
    current = next.serviceId
  }
  return current
}
