#!/usr/bin/env bun

export const SEMVER_TAG = /^\d+\.\d+\.\d+$/

const WINDOW_DAYS = 7
const IMAGE_PAGE_LIMIT = 100
const SANDBOX_PAGE_LIMIT = 50
const MAX_PAGES = 50

export interface PruneImage {
  id: string
  tags: string[]
  createdAt: number
  manifestDigest: string
}

export interface SandboxRef {
  image?: string
}

export interface PrunePlan {
  keep: PruneImage[]
  delete: PruneImage[]
}

export function planPrune(args: {
  images: PruneImage[]
  sandboxes: SandboxRef[]
  now: number
  windowMs: number
}): PrunePlan {
  const inUseDigests = new Set(
    args.sandboxes
      .map((sandbox) => sandbox.image?.split('@').at(-1))
      .filter((digest): digest is string => digest !== undefined),
  )
  const keep: PruneImage[] = []
  const remove: PruneImage[] = []
  for (const image of args.images) {
    const releaseTagged = image.tags.some((tag) => SEMVER_TAG.test(tag))
    const inWindow = args.now - image.createdAt <= args.windowMs
    const inUse = inUseDigests.has(image.manifestDigest)
    if (inUse || (releaseTagged && inWindow)) {
      keep.push(image)
    } else {
      remove.push(image)
    }
  }
  return { keep, delete: remove }
}

interface ImagePage {
  images: Array<{ id: string; tags: string[]; createdAt: string; manifestDigest: string }>
  nextCursor?: string | null
}

interface SandboxPage {
  sandboxes: SandboxRef[]
  pagination: { next?: string | null }
}

async function fetchJson(args: { api: string; token: string; path: string }): Promise<unknown> {
  const response = await fetch(`${args.api}${args.path}`, {
    headers: { Authorization: `Bearer ${args.token}` },
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    throw new Error(`GET ${args.path} answered ${response.status}`)
  }
  return response.json()
}

async function listAllImages(args: {
  api: string
  token: string
  teamId: string
  projectId: string
  repository: string
}): Promise<PruneImage[]> {
  const images: PruneImage[] = []
  const seenIds = new Set<string>()
  let cursor: string | undefined
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
    const query = `teamId=${args.teamId}&projectId=${args.projectId}&limit=${IMAGE_PAGE_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const page = (await fetchJson({
      api: args.api,
      token: args.token,
      path: `/v1/vcr/repository/${args.repository}/images?${query}`,
    })) as ImagePage
    if (page.images.length === 0) return images
    let fresh = 0
    for (const image of page.images) {
      if (seenIds.has(image.id)) continue
      seenIds.add(image.id)
      fresh++
      images.push({
        id: image.id,
        tags: image.tags,
        createdAt: Date.parse(image.createdAt),
        manifestDigest: image.manifestDigest,
      })
    }
    // The endpoint stops honoring the cursor and replays page one once it walks off the end:
    // a page with no new ids means the walk is done even if nextCursor is still set.
    if (!page.nextCursor || fresh === 0) return images
    cursor = page.nextCursor
    console.log(`  …${images.length} images so far`)
  }
  console.log(`::warning::image listing hit the ${MAX_PAGES}-page cap — results may be incomplete`)
  return images
}

async function listAllSandboxes(args: {
  api: string
  token: string
  teamId: string
  projectId: string
  project: string
}): Promise<SandboxRef[]> {
  const sandboxes: SandboxRef[] = []
  const seenNames = new Set<string>()
  let cursor: string | undefined
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber++) {
    const query = `teamId=${args.teamId}&projectId=${args.projectId}&project=${args.project}&limit=${SANDBOX_PAGE_LIMIT}${cursor ? `&next=${encodeURIComponent(cursor)}` : ''}`
    const page = (await fetchJson({
      api: args.api,
      token: args.token,
      path: `/v2/sandboxes?${query}`,
    })) as SandboxPage
    if (page.sandboxes.length === 0) return sandboxes
    let fresh = 0
    for (const sandbox of page.sandboxes) {
      const name = (sandbox as { name?: string }).name
      if (name !== undefined && seenNames.has(name)) continue
      if (name !== undefined) seenNames.add(name)
      fresh++
      sandboxes.push(sandbox)
    }
    // v2/sandboxes replays page one forever once the cursor walks off the end, so a page that
    // contributes nothing new is the real end of the list — pagination.next lies there.
    if (!page.pagination.next || fresh === 0) return sandboxes
    cursor = page.pagination.next
    console.log(`  …${sandboxes.length} sandboxes so far`)
  }
  console.log(`::warning::sandbox listing hit the ${MAX_PAGES}-page cap — results may be incomplete`)
  return sandboxes
}

async function deleteImage(args: {
  api: string
  token: string
  teamId: string
  projectId: string
  repository: string
  id: string
}): Promise<void> {
  const query = `teamId=${args.teamId}&projectId=${args.projectId}`
  const response = await fetch(`${args.api}/v1/vcr/repository/${args.repository}/images/${args.id}?${query}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${args.token}` },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`DELETE image ${args.id} answered ${response.status}`)
  }
}

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run')
  const token = process.env.VERCEL_TOKEN
  const teamId = process.env.VERCEL_TEAM_ID
  const projectId = process.env.VERCEL_PROJECT_ID
  if (!token || !teamId || !projectId) {
    console.error('VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID are required')
    return 2
  }
  const api = 'https://api.vercel.com'
  const repository = 'atlas-sandbox'
  const scope = { api, token, teamId, projectId, repository, project: 'atlas' }

  const [images, sandboxes] = await Promise.all([listAllImages(scope), listAllSandboxes(scope)])
  const plan = planPrune({ images, sandboxes, now: Date.now(), windowMs: WINDOW_DAYS * 24 * 60 * 60 * 1000 })

  console.log(
    `${images.length} images, ${sandboxes.length} live sandboxes; keeping ${plan.keep.length}, pruning ${plan.delete.length}${dryRun ? ' (dry run)' : ''}`,
  )
  for (const image of plan.delete) {
    const label = image.tags.length > 0 ? image.tags.join(', ') : '<untagged>'
    if (dryRun) {
      console.log(`would delete ${image.id} (${label})`)
      continue
    }
    try {
      await deleteImage({ ...scope, id: image.id })
      console.log(`deleted ${image.id} (${label})`)
    } catch (failure) {
      console.error(`::warning::could not delete ${image.id} (${label}): ${failure}`)
    }
  }
  return 0
}

if (import.meta.main) process.exit(await main())
