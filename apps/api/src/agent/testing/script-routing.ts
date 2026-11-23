import type { ModelPort, ProviderIdentity } from '@dltech/atlas-core'
import { ScriptedModel, type ScriptedModelStep } from '@dltech/atlas-agent/testing'

export type ScriptRoute = { needle: string; steps: readonly ScriptedModelStep[] }

const ROUTE_MARK = '#'
const HOST_MARK = '@'

const SCRIPTED_IDENTITY: ProviderIdentity = { id: 'scripted', modelId: 'scripted-1' }

export const scriptRoutesOf = (args: {
  sessionId: string
  host: string
  scripts: Record<string, ScriptedModelStep[]>
}): ScriptRoute[] =>
  Object.entries(args.scripts).flatMap(([key, steps]) => {
    const marked = key.indexOf(ROUTE_MARK)
    if (marked < 0 || key.slice(0, marked) !== args.sessionId) return []
    const route = key.slice(marked + 1)
    const at = route.lastIndexOf(HOST_MARK)
    const host = at < 0 ? undefined : route.slice(at + 1)
    if (host !== undefined && host !== args.host) return []
    return [{ needle: at < 0 ? route : route.slice(0, at), steps }]
  })

export const routedModelOf = (args: {
  routes: readonly ScriptRoute[]
  fallback: () => ModelPort
  fileExists?: (path: string) => boolean
}): ModelPort => {
  const ports = new Map<string, ModelPort>()
  const portOf = (key: string, build: () => ModelPort): ModelPort => {
    const seen = ports.get(key)
    if (seen !== undefined) return seen
    const built = build()
    ports.set(key, built)
    return built
  }
  return {
    identity: SCRIPTED_IDENTITY,
    step: (stepArgs) => {
      const request = JSON.stringify(stepArgs.assembled)
      const route = args.routes.find((candidate) => request.includes(candidate.needle))
      const steps = route?.steps
      const port =
        steps === undefined
          ? portOf('', args.fallback)
          : portOf(route?.needle ?? '', () => new ScriptedModel(steps, undefined, args.fileExists))
      return port.step(stepArgs)
    },
  }
}
