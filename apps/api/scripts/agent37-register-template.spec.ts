import { afterEach, describe, expect, it } from 'bun:test'

import {
  expectedRefOf,
  isTemplateCurrent,
  sourceOf,
  verifyTemplate,
} from './agent37-register-template'

const REF = 'ghcr.io/dennisofficial/atlas-sandbox'
const DIGEST = 'sha256:9f1c0c4e6b1d2a3f4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

const answerOf = (args: {
  status: number
  body: unknown
  headers?: Record<string, string>
}): Response =>
  ({
    status: args.status,
    ok: args.status >= 200 && args.status < 300,
    headers: new Headers(args.headers ?? {}),
    json: async (): Promise<unknown> => args.body,
  }) as unknown as Response

describe('sourceOf', () => {
  it('pins the tag passed on the command line', () => {
    expect(sourceOf(['bun', 'script.ts', '--tag', 'sha-abc1234'], {})).toBe('sha-abc1234')
  })

  it('falls back to AGENT37_IMAGE_TAG and then latest', () => {
    expect(sourceOf(['bun', 'script.ts'], { AGENT37_IMAGE_TAG: ' sha-def5678 ' })).toBe(
      'sha-def5678',
    )
    expect(sourceOf(['bun', 'script.ts'], {})).toBe('latest')
  })

  it('refuses a --tag with no value', () => {
    expect(() => sourceOf(['bun', 'script.ts', '--tag'], {})).toThrow('--tag needs a value')
  })
})

describe('expectedRefOf', () => {
  it('pins a full digest as given', async () => {
    expect(await expectedRefOf(DIGEST)).toBe(`${REF}@${DIGEST}`)
  })

  it('resolves a tag through ghcr to the amd64 manifest digest', async () => {
    const calls: string[] = []
    globalThis.fetch = (async (input: string | URL): Promise<Response> => {
      calls.push(String(input))
      if (String(input).startsWith('https://ghcr.io/token')) {
        return answerOf({ status: 200, body: { token: 'registry-token' } })
      }
      return answerOf({
        status: 200,
        headers: { 'docker-content-digest': 'sha256:index' },
        body: {
          manifests: [
            { digest: 'sha256:arm64', platform: { os: 'linux', architecture: 'arm64' } },
            { digest: DIGEST, platform: { os: 'linux', architecture: 'amd64' } },
          ],
        },
      })
    }) as unknown as typeof fetch
    expect(await expectedRefOf('sha-abc1234')).toBe(`${REF}@${DIGEST}`)
    expect(calls[1]).toBe('https://ghcr.io/v2/dennisofficial/atlas-sandbox/manifests/sha-abc1234')
  })
})

describe('isTemplateCurrent', () => {
  const answer = (args: { status: number; body: unknown }): void => {
    globalThis.fetch = (async (): Promise<Response> => answerOf(args)) as unknown as typeof fetch
  }

  it('is current when the template already pins the expected image', async () => {
    answer({ status: 200, body: { name: 'atlas-sandbox', image_ref: `${REF}@${DIGEST}` } })
    expect(await isTemplateCurrent({ apiKey: 'k', expectedRef: `${REF}@${DIGEST}` })).toBe(true)
  })

  it('is stale when the template pins another image', async () => {
    answer({ status: 200, body: { name: 'atlas-sandbox', image_ref: `${REF}@sha256:old` } })
    expect(await isTemplateCurrent({ apiKey: 'k', expectedRef: `${REF}@${DIGEST}` })).toBe(false)
  })

  it('is stale when the template does not exist yet', async () => {
    answer({ status: 404, body: { error: 'not_found' } })
    expect(await isTemplateCurrent({ apiKey: 'k', expectedRef: `${REF}@${DIGEST}` })).toBe(false)
  })

  it('refuses any other answer', async () => {
    answer({ status: 500, body: { error: 'boom' } })
    await expect(
      isTemplateCurrent({ apiKey: 'k', expectedRef: `${REF}@${DIGEST}` }),
    ).rejects.toThrow('agent37 refused to read template atlas-sandbox: 500')
  })
})

describe('verifyTemplate', () => {
  const readBack = (template: unknown): void => {
    globalThis.fetch = (async (): Promise<Response> =>
      answerOf({ status: 200, body: template })) as unknown as typeof fetch
  }

  it('accepts the template once the stored image is the pinned ref', async () => {
    readBack({ name: 'atlas-sandbox', revision: 7, image_ref: `${REF}@${DIGEST}` })
    expect(await verifyTemplate({ apiKey: 'k', expectedRef: `${REF}@${DIGEST}` })).toEqual({
      name: 'atlas-sandbox',
      revision: 7,
      image_ref: `${REF}@${DIGEST}`,
    })
  })

  it('refuses a template that still points at another image', async () => {
    readBack({ name: 'atlas-sandbox', revision: 7, image_ref: `${REF}@sha256:stale` })
    await expect(verifyTemplate({ apiKey: 'k', expectedRef: `${REF}@${DIGEST}` })).rejects.toThrow(
      `template atlas-sandbox points at ${REF}@sha256:stale, expected ${REF}@${DIGEST}`,
    )
  })
})
