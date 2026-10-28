import type { AtlasApp } from './compose'
import { reapExpiredSandboxesOnBoot } from './live-cloud'
import { reapOrphanPodsOnBoot } from './live-pod'

export type BootReapers = {
  sandboxes: (app: AtlasApp) => void
  pods: (app: AtlasApp) => void
}

export const reapOnBootWith =
  (reapers: BootReapers) =>
  (app: AtlasApp): void => {
    if (app.pods) {
      reapers.pods(app)
      return
    }
    reapers.sandboxes(app)
  }

export const reapOnBootAll = reapOnBootWith({
  sandboxes: reapExpiredSandboxesOnBoot,
  pods: reapOrphanPodsOnBoot,
})
