import { describe, expect, it } from 'vitest'

import type { PodExecResult } from '../../../execution/docker/pod-engine'
import { ensurePodIngress, POD_INGRESS_SCRIPT_PATH, type PodIngressEngine } from '../ingress'

type Written = { id: string; path: string; content: Uint8Array | string; mode?: number | undefined }

const result = (args: { exitCode: number; stdout?: string }): PodExecResult => ({
  exitCode: args.exitCode,
  stdout: async () => args.stdout ?? '',
  stderr: async () => '',
})

const fakeEngine = (args: { listeningAfterLaunch: boolean; alreadyListening?: boolean }) => {
  const writes: Written[] = []
  const scripts: string[] = []
  let launched = args.alreadyListening === true

  const engine: PodIngressEngine = {
    async writeFile(write) {
      writes.push(write)
    },
    async execSh({ script }) {
      scripts.push(script)
      if (script.includes('curl')) return result({ exitCode: launched ? 0 : 7 })
      if (script.includes('setsid')) {
        launched = args.listeningAfterLaunch
        return result({ exitCode: 0 })
      }
      return result({ exitCode: 0, stdout: 'Error: listen EADDRINUSE\n' })
    },
  }
  return { engine, writes, scripts }
}

describe('ensurePodIngress', () => {
  it('does nothing when the proxy already answers', async () => {
    const fake = fakeEngine({ listeningAfterLaunch: true, alreadyListening: true })

    await ensurePodIngress({ engine: fake.engine, id: 'pod', ingressHostPort: 23_457 })

    expect(fake.writes).toEqual([])
    expect(fake.scripts.some((script) => script.includes('setsid'))).toBe(false)
  })

  it('writes the script and launches it detached against loopback', async () => {
    const fake = fakeEngine({ listeningAfterLaunch: true })

    await ensurePodIngress({ engine: fake.engine, id: 'pod', ingressHostPort: 23_457 })

    expect(fake.writes).toHaveLength(1)
    const [written] = fake.writes
    expect(written?.id).toBe('pod')
    expect(written?.path).toBe(POD_INGRESS_SCRIPT_PATH)
    expect(written?.mode).toBe(0o644)
    expect(String(written?.content)).toContain('const listenPort = 7676')
    expect(String(written?.content)).toContain('23457')

    const launch = fake.scripts.find((script) => script.includes('setsid'))
    expect(launch).toContain('ATLAS_PROXY_TARGET=127.0.0.1')
    expect(launch).toContain(`node ${POD_INGRESS_SCRIPT_PATH}`)
    expect(launch?.trimEnd().endsWith('&')).toBe(true)
  })

  it('throws with the log tail when the proxy never answers', async () => {
    const fake = fakeEngine({ listeningAfterLaunch: false })

    const failure = await ensurePodIngress({
      engine: fake.engine,
      id: 'pod',
      ingressHostPort: 23_457,
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('did not answer')
    expect((failure as Error).message).toContain('EADDRINUSE')
  }, 20_000)
})
