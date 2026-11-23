import { ESandboxStatus, type SessionStatusOutput } from '@dltech/atlas-protocol'

const PARKED: ReadonlySet<ESandboxStatus> = new Set([
  ESandboxStatus.Sleeping,
  ESandboxStatus.Stopped,
  ESandboxStatus.Stopping,
  ESandboxStatus.Deleting,
  ESandboxStatus.Deleted,
  ESandboxStatus.Failed,
])

export const isPodParked = (status: SessionStatusOutput | undefined): boolean => {
  const sandbox = status?.sandbox
  if (sandbox === undefined || sandbox === null) return false
  return PARKED.has(sandbox.status)
}

export const podAttached = (status: SessionStatusOutput | undefined): boolean =>
  !isPodParked(status)

export const podReady = (status: SessionStatusOutput | undefined): boolean => {
  if (!podAttached(status) || status === undefined) return false
  const { holderHostId, live } = status.lease
  return holderHostId !== null && live
}
