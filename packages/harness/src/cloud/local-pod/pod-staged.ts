import { SERVE_HOME } from '@dltech/atlas-wire'

import type { DockerPodEngine } from '../../execution/docker/pod-engine'

export const POD_STAGED_PATH = `${SERVE_HOME}/pod-staged`

export type PodStagedEngine = Pick<DockerPodEngine, 'execSh' | 'writeFile'>

const PROBE_TIMEOUT_MS = 15_000
const MARKER_MODE = 0o600
const MARKER_ABSENT_EXIT = 1

export const isPodStaged = async (args: {
  engine: PodStagedEngine
  id: string
  name: string
}): Promise<boolean> => {
  const probe = await args.engine.execSh({
    id: args.id,
    script: `test -e ${POD_STAGED_PATH}`,
    timeoutMs: PROBE_TIMEOUT_MS,
  })
  if (probe.exitCode === 0) return true
  if (probe.exitCode === MARKER_ABSENT_EXIT) return false
  throw new Error(
    `could not check whether pod ${args.name} finished staging (exit ${probe.exitCode}): ${await probe.stderr()}`,
  )
}

export const stagePod = async (args: {
  engine: PodStagedEngine
  id: string
  name: string
  putContext: ((handle: { name: string }) => Promise<void>) | undefined
}): Promise<void> => {
  await args.putContext?.({ name: args.name })
  await args.engine.writeFile({
    id: args.id,
    path: POD_STAGED_PATH,
    content: '1',
    mode: MARKER_MODE,
  })
}
