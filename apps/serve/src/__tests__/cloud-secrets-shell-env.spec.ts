import { afterEach, describe, expect, it } from 'bun:test'

import { startShell } from '@dltech/atlas-harness'

import { apply, cleanupCloudState, cloudWith, tempHome } from './cloud-state-harness'

const PROBE = 'CLOUD_SECRET_PROBE'

const config = {
  settings: {},
  harnessSecrets: [{ name: 'search.exa', value: 'harness-value' }],
  secrets: [
    { name: PROBE, value: 'bar' },
    { name: 'decisions.token.vercel', value: 'decisions-value' },
    { name: '1INVALID', value: 'invalid-value' },
    { name: 'HOME', value: '/hijacked' },
  ],
  mcpServers: [],
  provenance: {},
}

const shellEnv = async (): Promise<string> => {
  const started = startShell({ command: 'env', cwd: tempHome() })
  if (!started.ok) throw new Error(started.reason)
  const text = await new Response(started.shell.stdout).text()
  await started.shell.exited
  return text
}

afterEach(async () => {
  delete process.env[PROBE]
  await cleanupCloudState()
})

describe('project secrets in a sandbox shell', () => {
  it('reach a bash tool child env by name, leaving out internal entries, invalid names and harness vars', async () => {
    const home = process.env.HOME
    await apply({
      home: tempHome(),
      cloud: cloudWith({ config }),
      env: process.env,
    })

    const lines = (await shellEnv()).split('\n')
    expect(lines).toContain(`${PROBE}=bar`)
    expect(lines.some((line) => line.includes('decisions-value'))).toBe(false)
    expect(lines.some((line) => line.includes('harness-value'))).toBe(false)
    expect(lines.some((line) => line.includes('invalid-value'))).toBe(false)
    expect(lines).toContain(`HOME=${home}`)
  })
})
