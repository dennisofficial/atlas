export enum ESandboxCostProvider {
  Vercel = 'vercel',
  Agent37 = 'agent37',
}

export enum ESandboxCostSource {
  Estimate = 'estimate',
  Measured = 'measured',
  Metered = 'metered',
}

export type VercelSandboxRates = {
  provider: ESandboxCostProvider.Vercel
  effectiveFrom: string
  activeCpuPerVcpuHourUsd: number
  memoryPerGbHourUsd: number
}

export type Agent37SandboxRates = {
  provider: ESandboxCostProvider.Agent37
  effectiveFrom: string
  vcpuPerMonthUsd: number
  memoryPerGbMonthUsd: number
  diskPerGbMonthUsd: number
  monthHours: number
  typeMultiplier: number
}

export type SandboxRates = VercelSandboxRates | Agent37SandboxRates

// https://vercel.com/docs/sandbox/pricing — Pro, region iad1, page updated 2026-09-10.
export const VERCEL_RATES: VercelSandboxRates = {
  provider: ESandboxCostProvider.Vercel,
  effectiveFrom: '2026-09-10',
  activeCpuPerVcpuHourUsd: 0.128,
  memoryPerGbHourUsd: 0.0212,
}

// https://www.agent37.com/docs/agents-api/billing.md — the vm type multiplier scales compute only.
export const AGENT37_RATES: Agent37SandboxRates = {
  provider: ESandboxCostProvider.Agent37,
  effectiveFrom: '2026-10-21',
  vcpuPerMonthUsd: 0.8,
  memoryPerGbMonthUsd: 0.7,
  diskPerGbMonthUsd: 0.09,
  monthHours: 730,
  typeMultiplier: 2.5,
}

export const SANDBOX_RATES: readonly SandboxRates[] = [VERCEL_RATES, AGENT37_RATES]

const providerRatesOf = (provider: ESandboxCostProvider): readonly SandboxRates[] =>
  SANDBOX_RATES.filter((rates) => rates.provider === provider)

export const rateAt = (args: { provider: ESandboxCostProvider; at: number }): SandboxRates => {
  const rates = providerRatesOf(args.provider)
  const inForce = rates.filter((candidate) => Date.parse(candidate.effectiveFrom) <= args.at)
  const chosen = inForce[inForce.length - 1] ?? rates[0]
  if (chosen === undefined) throw new Error(`no sandbox rates for ${args.provider}`)
  return chosen
}
