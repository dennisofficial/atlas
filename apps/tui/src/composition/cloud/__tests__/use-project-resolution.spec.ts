import { describe, expect, it } from 'bun:test'

import { CloudClient } from '@dltech/atlas-harness'

import { EProjectAnswer, type ProjectRequest } from '../../../ui/project-prompt-model'
import { launchDirWith, ACME_ORIGIN } from '../../__tests__/born-thread-fixture'
import { resolveProject } from '../use-project-resolution'

const gatedClient = (args: { gate: Promise<void>; requests: string[] }): CloudClient =>
  new CloudClient({
    url: 'https://cloud.test',
    token: 'test',
    fetchFn: (async (_url: string, init?: RequestInit) => {
      args.requests.push(init?.method ?? 'GET')
      await args.gate
      return Response.json({ result: { data: [] } })
    }) as unknown as typeof fetch,
  })

describe('resolveProject after the workspace is gone', () => {
  it('cancels without asking or creating when the list resolves after unmount', async () => {
    let mounted = true
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const requests: string[] = []
    const asked: ProjectRequest[] = []

    const pending = resolveProject({
      cwd: launchDirWith(ACME_ORIGIN),
      client: gatedClient({ gate, requests }),
      ask: async (request) => {
        asked.push(request)
        return { kind: EProjectAnswer.Create, name: 'widgets', baseBranch: null }
      },
      isMounted: () => mounted,
    })
    mounted = false
    release()

    expect(await pending).toBe('cancelled')
    expect(asked).toEqual([])
    expect(requests).toEqual(['GET'])
  })

  it('cancels without creating when the prompt is answered after unmount', async () => {
    let mounted = true
    const requests: string[] = []

    const resolution = await resolveProject({
      cwd: launchDirWith(ACME_ORIGIN),
      client: gatedClient({ gate: Promise.resolve(), requests }),
      ask: async () => {
        mounted = false
        return { kind: EProjectAnswer.Create, name: 'widgets', baseBranch: null }
      },
      isMounted: () => mounted,
    })

    expect(resolution).toBe('cancelled')
    expect(requests).toEqual(['GET'])
  })
})
