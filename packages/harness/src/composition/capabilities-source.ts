import {
  EExecutionLocation,
  type CapabilitiesSource,
  type EnvironmentCapabilities,
} from '@dltech/atlas-core'

import { probeDockerCapabilities } from '../execution/docker/host-environment'

import type { ExecutionLocationState } from './execution-location-state'

type Probe = (args: {
  cwd: string
  env: Record<string, string | undefined>
}) => Promise<EnvironmentCapabilities>

/**
 * The assembly rule is synchronous, so the probe is kicked on the first Docker assembly and the
 * note simply appears from the next one on; a probe that fails (a platform without uid/gid) is
 * swallowed into a permanent undefined rather than ever rejecting into the assembly path.
 */
export function dockerCapabilitiesSource(args: {
  executionLocation: ExecutionLocationState
  cwd: string
  env: Record<string, string | undefined>
  probe?: Probe | undefined
}): CapabilitiesSource {
  const probe = args.probe ?? probeDockerCapabilities
  let held: EnvironmentCapabilities | undefined
  let started = false

  const cached = (): EnvironmentCapabilities | undefined => {
    if (held !== undefined || started) return held
    started = true
    void probe({ cwd: args.cwd, env: args.env })
      .then((value) => {
        held = value
      })
      .catch(() => undefined)
    return undefined
  }

  return ({ threadId }) => {
    const location = args.executionLocation.of(threadId) ?? args.executionLocation.current()
    if (location !== EExecutionLocation.Docker) return undefined
    return cached()
  }
}
