import type { Scenario } from './rig-context'
import { EVerdict, type ScenarioEvidence } from './rig-evidence'

const ID = 6
const SLUG = 'api-wake'
const TITLE = 'API wake'

export const API_WAKE_NOT_RUN_REASON = [
  'GithubSandboxWakeService.notifyEvent (apps/api/src/api/cloud/github/github-sandbox-wake.service.ts) is reachable',
  'only through `POST /v1/github/hooks/:repo` (a GitHub webhook) or the poll sweeper.',
  'There is no debug route, and the rig sends no real GitHub events.',
].join(' ')

const runApiWake = async (): Promise<ScenarioEvidence> => ({
  id: ID,
  slug: SLUG,
  title: TITLE,
  commands: [],
  observations: [],
  logs: [],
  verdict: EVerdict.NotRun,
  reason: API_WAKE_NOT_RUN_REASON,
})

export const apiWakeScenario: Scenario = { id: ID, slug: SLUG, title: TITLE, run: runApiWake }
