import type { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'
import { VercelSandboxClient } from '../sandboxes/vercel-sandbox.client'
import { TeammateArchiveStopService } from './teammate-archive-stop'
import { inertSignals } from './thread-signals.fixture'

const neverLookedUp: SandboxCredentials = {
  forThread: () => Promise.reject(new Error('a spec never reaches Vercel credentials')),
  forUser: () => Promise.reject(new Error('a spec never reaches Vercel credentials')),
}

/** A teammate stop wired to record its calls; the in-pod curl still runs against no sandbox. */
export const recordingTeammateStop = (): {
  service: TeammateArchiveStopService
  stops: string[]
} => {
  const stops: string[] = []
  const vercel = new VercelSandboxClient(neverLookedUp)
  const original = vercel.stopTeammate.bind(vercel)
  vercel.stopTeammate = (args) => {
    stops.push(args.agentId)
    return original(args)
  }
  return { service: new TeammateArchiveStopService(vercel, inertSignals()), stops }
}

/** A teammate stop that never runs: specs assert the archive wrote it, not the stop. */
export const inertTeammateStop = (): TeammateArchiveStopService => {
  const service = new TeammateArchiveStopService(
    new VercelSandboxClient(neverLookedUp),
    inertSignals(),
  )
  service.stopIfManaged = () => Promise.resolve()
  return service
}
