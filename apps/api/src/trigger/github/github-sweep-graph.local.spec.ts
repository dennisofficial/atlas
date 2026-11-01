import { Logger } from '@nestjs/common'
import { expect, it, spyOn } from 'bun:test'
import { EnvService } from '../../_core/config/env/env.service'
import { buildGithubSweepGraph } from './github-sweep-graph'

it('reports that a worker without Redis cannot share API observation leases', async () => {
  const warning = spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  try {
    const graph = buildGithubSweepGraph({
      env: new EnvService({ SECRETS_ENCRYPTION_KEY: '0'.repeat(64) }),
    })
    try {
      expect(warning).toHaveBeenCalledWith(
        'GitHub observation leases are same-process only without Redis; a separate worker cannot share API view leases',
      )
    } finally {
      await graph.dispose()
    }
  } finally {
    warning.mockRestore()
  }
})
