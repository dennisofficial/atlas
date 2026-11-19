import { expect, it, spyOn } from 'bun:test'
import { EnvService } from '../../_core/config/env/env.service'
import { triggerLog } from '../trigger-logger'
import { buildGithubSweepGraph } from './github-sweep-graph'

it('reports that a worker without Redis cannot share the API request budget', async () => {
  const warning = spyOn(triggerLog, 'warn').mockImplementation(() => undefined)
  try {
    const graph = buildGithubSweepGraph({
      env: new EnvService({ SECRETS_ENCRYPTION_KEY: '0'.repeat(64) }),
    })
    try {
      expect(warning).toHaveBeenCalledWith(
        'Without Redis the GitHub request budget and PR frames stay in this process; the API and this worker cannot share them',
      )
    } finally {
      await graph.dispose()
    }
  } finally {
    warning.mockRestore()
  }
})
