import { EKilledBy, EServiceStatus, servicesLifecycle, type Event } from '@dltech/atlas-core'

const SESSION_ENDED_BY: ReadonlySet<EKilledBy | undefined> = new Set([
  EKilledBy.IdlePark,
  EKilledBy.SessionEnd,
  EKilledBy.ContainerSwitch,
  EKilledBy.Rotation,
  EKilledBy.LostContact,
  EKilledBy.Unrecorded,
])

export function declaredServicesToResume({ events }: { events: readonly Event[] }): string[] {
  const latest = new Map<string, ReturnType<typeof servicesLifecycle>[number]>()
  for (const lifecycle of servicesLifecycle(events)) {
    const { name } = lifecycle.started
    if (name === undefined) continue
    latest.delete(name)
    latest.set(name, lifecycle)
  }

  return [...latest.entries()]
    .filter(([, { ending }]) => {
      if (ending === undefined) return true
      return ending.status === EServiceStatus.Killed && SESSION_ENDED_BY.has(ending.killedBy)
    })
    .map(([name]) => name)
}
