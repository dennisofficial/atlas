import type { BoundPort } from '../execution/docker/ports'
import { ESandboxState, type SandboxStatus } from '../execution/docker/status'

export type SandboxLimits = { cpus: number; memoryGb: number }

export type SandboxContainer = {
  state: ESandboxState
  image: string
  label: string
  name?: string | undefined
  limits?: SandboxLimits | undefined
  ports: readonly BoundPort[]
  reason?: string | undefined
}

export type SandboxStatusState = {
  current: () => SandboxContainer
  mark: (status: SandboxStatus) => void
  subscribe: (listener: () => void) => () => void
}

const merged = (args: {
  held: SandboxContainer
  status: SandboxStatus
}): SandboxContainer => {
  const { held, status } = args
  switch (status.state) {
    case ESandboxState.Starting:
      return { ...held, state: status.state }
    case ESandboxState.Running:
      return { ...held, state: status.state, name: status.name, ports: status.ports }
    case ESandboxState.Stopped:
      return { ...held, state: status.state }
    case ESandboxState.Failed:
      return { ...held, state: status.state, reason: status.reason }
  }
}

export function createSandboxStatusState(args: {
  image: string
  label: string
  limits?: SandboxLimits | undefined
}): SandboxStatusState {
  let held: SandboxContainer = {
    state: ESandboxState.Stopped,
    image: args.image,
    label: args.label,
    ...(args.limits === undefined ? {} : { limits: args.limits }),
    ports: [],
  }
  const listeners = new Set<() => void>()

  return {
    current: () => held,
    mark: (status) => {
      held = merged({ held, status })
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
