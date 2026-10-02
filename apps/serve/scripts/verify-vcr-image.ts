#!/usr/bin/env bun

import { $ } from 'bun'
import { randomBytes } from 'node:crypto'

const CREATE_BUDGET_MS = 10 * 60 * 1000
const POLL_DELAY_MS = 20_000
const HEAL_ATTEMPTS = 2
const BAKE_ID_PATH = 'apps/serve/sandbox-image/atlas-serve.bake-id'

export type ImageReadiness = 'ready' | 'not-ready' | 'poisoned' | 'unexpected'

type CreateOutcome = { readiness: ImageReadiness; sandboxName?: string; detail: string }

const errorFieldOf = (body: unknown): Record<string, unknown> | undefined => {
  if (typeof body !== 'object' || body === null) return undefined
  const error = (body as { error?: unknown }).error
  return typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : undefined
}

export function classifyCreateResponse(args: { status: number; body: unknown }): ImageReadiness {
  if (args.status === 200) return 'ready'
  if (args.status !== 409) return 'unexpected'
  const error = errorFieldOf(args.body)
  if (error?.code !== 'image_not_ready') return 'unexpected'
  const message = typeof error.message === 'string' ? error.message : ''
  return message.includes('optimization failed') ? 'poisoned' : 'not-ready'
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function createSandbox(args: {
  api: string
  token: string
  teamId: string
  projectId: string
  image: string
}): Promise<CreateOutcome> {
  const name = `atlas-image-verify-${randomBytes(4).toString('hex')}`
  const response = await fetch(`${args.api}/v3/sandboxes?teamId=${args.teamId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: args.projectId,
      image: args.image,
      name,
      region: 'iad1',
      timeout: 60_000,
    }),
    signal: AbortSignal.timeout(90_000),
  })
  const body: unknown = await response.json().catch(() => undefined)
  if (response.status === 200) return { readiness: 'ready', sandboxName: name, detail: '' }
  const readiness = classifyCreateResponse({ status: response.status, body })
  return { readiness, detail: JSON.stringify(body ?? `status ${response.status}`) }
}

async function deleteSandbox(args: {
  api: string
  token: string
  teamId: string
  projectId: string
  name: string
}): Promise<void> {
  await fetch(
    `${args.api}/v2/sandboxes/${args.name}?teamId=${args.teamId}&projectId=${args.projectId}&deleteOrphanSnapshots=true`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${args.token}` },
      signal: AbortSignal.timeout(30_000),
    },
  ).catch(() => undefined)
}

/**
 * Creates a throwaway sandbox against the image: the create is what triggers Vercel's
 * optimization, so a success here also pre-warms the digest for every client that pins the tag.
 * A poisoned digest answers instantly forever, so the lag branch is bounded by a budget.
 */
async function waitForOptimization(args: {
  api: string
  token: string
  teamId: string
  projectId: string
  image: string
}): Promise<ImageReadiness> {
  const deadline = Date.now() + CREATE_BUDGET_MS
  for (;;) {
    const outcome = await createSandbox(args)
    if (outcome.readiness === 'ready') {
      if (outcome.sandboxName !== undefined) {
        await deleteSandbox({ ...args, name: outcome.sandboxName })
      }
      return 'ready'
    }
    if (outcome.readiness === 'unexpected') {
      console.error(`unexpected response creating the verify sandbox: ${outcome.detail}`)
      return 'unexpected'
    }
    console.log(`image not ready (${outcome.readiness}) — waiting`)
    if (outcome.readiness === 'poisoned') return 'poisoned'
    if (Date.now() > deadline) return 'not-ready'
    await sleep(POLL_DELAY_MS)
  }
}

/**
 * Forces a fresh manifest digest: the bake stamp is a layer in the image, so rewriting it and
 * rebuilding changes the digest even when the rebuild is fully cached. The poisoned optimization
 * result lives on the digest, so a fresh digest gets a fresh roll of the dice.
 */
async function republishUnderFreshDigest(args: {
  vcrImage: string
  tag: string
  ghcrImage: string
}): Promise<void> {
  await Bun.write(BAKE_ID_PATH, `${Date.now()}\n`)
  await $`docker buildx build
    --platform linux/amd64
    --provenance=false
    --tag ${`${args.vcrImage}:${args.tag}`}
    --cache-from type=registry,ref=${`${args.ghcrImage}:buildcache`}
    --output type=image,push=true,oci-mediatypes=true,compression=zstd,compression-level=3,force-compression=true
    apps/serve/sandbox-image`.quiet()
}

async function main(): Promise<number> {
  const image = process.argv[2]
  if (image === undefined) {
    console.error('usage: bun apps/serve/scripts/verify-vcr-image.ts <image>')
    return 2
  }
  const token = process.env.VERCEL_TOKEN
  const teamId = process.env.VERCEL_TEAM_ID
  const projectId = process.env.VERCEL_PROJECT_ID
  const vcrImage = process.env.VCR_IMAGE
  const ghcrImage = process.env.IMAGE
  if (!token || !teamId || !projectId || !vcrImage || !ghcrImage) {
    console.error('VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID, VCR_IMAGE and IMAGE are required')
    return 2
  }
  const tag = image.split(':').at(-1) ?? image
  const probe = { api: 'https://vercel.com/api', token, teamId, projectId, image }

  for (let heal = 0; ; heal++) {
    const readiness = await waitForOptimization(probe)
    if (readiness === 'ready') {
      console.log(`image ${image} optimizes and boots`)
      return 0
    }
    if (readiness === 'not-ready') {
      console.log(`::error::image ${image} still not ready after ${CREATE_BUDGET_MS / 60_000} minutes`)
      return 1
    }
    if (readiness === 'unexpected') return 1
    if (heal >= HEAL_ATTEMPTS) {
      console.log(
        `::error::image ${image} failed Vercel's optimization ${heal + 1} times across fresh digests — this is a Vercel-side rejection, not a flake`,
      )
      return 1
    }
    console.log(`optimization failed for the published digest — republishing under a fresh one (heal ${heal + 1}/${HEAL_ATTEMPTS})`)
    await republishUnderFreshDigest({ vcrImage, tag, ghcrImage })
  }
}

if (import.meta.main) process.exit(await main())
