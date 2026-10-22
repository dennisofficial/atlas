import {
  EBootStep,
  EBootStepState,
  EPodState,
  type EVercelCredentialGap,
  type PodStatus,
  type RecordedBootStep,
} from '@dltech/atlas-wire/web'

export const NOT_CONFIGURED_FALLBACK = 'Atlas Cloud could not start a sandbox for this thread.'

export type NotConfigured = { error: string; gap: EVercelCredentialGap }

const atOf = (step: RecordedBootStep): number => Date.parse(step.at)

function latestProvisionOf(steps: readonly RecordedBootStep[]): RecordedBootStep | undefined {
  return steps
    .filter((step) => step.step === EBootStep.Provision)
    .reduce<RecordedBootStep | undefined>(
      (latest, step) => (latest === undefined || atOf(step) >= atOf(latest) ? step : latest),
      undefined,
    )
}

export function notConfiguredOf(pod: PodStatus | null): NotConfigured | null {
  if (pod === null || pod.state !== EPodState.Failed) return null
  const latest = latestProvisionOf(pod.steps)
  if (latest === undefined || latest.state !== EBootStepState.Error) return null
  if (latest.gap === undefined) return null
  return { error: latest.error ?? NOT_CONFIGURED_FALLBACK, gap: latest.gap }
}
