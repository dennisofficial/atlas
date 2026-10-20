import type { DockerPodEngine } from '../../execution/docker/pod-engine'

export type PodServeEngine = Pick<DockerPodEngine, 'execSh' | 'writeFile'>

export type PodTarget = { engine: PodServeEngine; id: string; name: string }

export type PodLog = ((line: string) => void) | undefined

const GUEST_KILL_GRACE_SECONDS = 5
const HOST_DEADLINE_MARGIN_SECONDS = 15

export const shellQuoted = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

export const boundedScript = (args: {
  script: string
  seconds: number
}): { script: string; timeoutMs: number } => ({
  script: `timeout -k ${GUEST_KILL_GRACE_SECONDS} ${args.seconds} sh -c ${shellQuoted(args.script)}`,
  timeoutMs: (args.seconds + HOST_DEADLINE_MARGIN_SECONDS) * 1000,
})
