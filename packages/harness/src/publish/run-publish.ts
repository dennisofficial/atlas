import { createHash } from 'node:crypto'

import {
  PUBLISHED_BUNDLE_CONTENT_TYPE,
  PUBLISHED_BUNDLE_MAX_BYTES,
  type PublishedBundleManifest,
  type PublishedBundleSummary,
} from '@dltech/atlas-wire'

import { buildContextArchive } from '../cloud/context-archive'
import type { PublishedBundleClient } from '../cloud/published-bundle-client'

import { EPublishKind, type Publishable } from './publishables'

export enum EPublishStage {
  Packing = 'packing',
  Uploading = 'uploading',
  Committing = 'committing',
}

const ERROR_BODY_CHARS = 300

export const manifestOf = (items: readonly Publishable[]): PublishedBundleManifest => {
  const labelsOf = (kind: EPublishKind): string[] =>
    items.filter((item) => item.kind === kind).map((item) => item.label)
  return {
    skills: labelsOf(EPublishKind.Skill),
    instructions: labelsOf(EPublishKind.Instructions),
    mcp: items.some((item) => item.kind === EPublishKind.Mcp),
  }
}

export async function publishBundle(args: {
  items: readonly Publishable[]
  client: PublishedBundleClient
  fetchFn?: typeof fetch | undefined
  onStage?: ((args: { stage: EPublishStage; bytes: number | null }) => void) | undefined
}): Promise<PublishedBundleSummary> {
  const fetchFn = args.fetchFn ?? fetch
  const stage = (next: { stage: EPublishStage; bytes: number | null }): void => args.onStage?.(next)

  stage({ stage: EPublishStage.Packing, bytes: null })
  const archive = await buildContextArchive({
    files: args.items.flatMap((item) =>
      item.files.map((file) => ({ key: file.archiveKey, path: file.path })),
    ),
  })
  if (archive === undefined)
    throw new Error('nothing to publish: none of the selected files could be read')
  if (archive.byteLength > PUBLISHED_BUNDLE_MAX_BYTES) {
    throw new Error(
      `the bundle is ${archive.byteLength} bytes, over the ${PUBLISHED_BUNDLE_MAX_BYTES} byte limit — deselect some skills`,
    )
  }
  const sha256 = createHash('sha256').update(archive).digest('hex')

  const upload = await args.client.requestUpload()
  if (archive.byteLength > upload.maximumSizeInBytes) {
    throw new Error(
      `the bundle is ${archive.byteLength} bytes, over the ${upload.maximumSizeInBytes} byte upload limit`,
    )
  }

  stage({ stage: EPublishStage.Uploading, bytes: archive.byteLength })
  const response = await fetchFn(upload.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': PUBLISHED_BUNDLE_CONTENT_TYPE },
    body: archive as NonNullable<RequestInit['body']>,
  })
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, ERROR_BODY_CHARS)
    throw new Error(
      `the upload to storage failed with ${response.status}${detail === '' ? '' : `: ${detail}`}`,
    )
  }

  stage({ stage: EPublishStage.Committing, bytes: null })
  return await args.client.commit({
    pathname: upload.pathname,
    sha256,
    manifest: manifestOf(args.items),
  })
}
