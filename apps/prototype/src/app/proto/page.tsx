import { join } from 'node:path'

import { safeFramePath } from '@/proto/frame-path'
import { buildPageTree, firstPageUrl } from '@/proto/page-tree'
import { ProtoChrome } from '@/proto/proto-chrome'
import { PROTO_SAMPLES } from '@/proto/samples'
import { scanPageDirs } from '@/proto/scan-pages'
import { formatViewportParam, parseViewportParam } from '@/proto/viewport-param'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function ProtoPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const appRoot = join(process.cwd(), 'src', 'app')
  const tree = buildPageTree({ pageDirs: scanPageDirs(appRoot), samples: PROTO_SAMPLES })
  const initialPath = safeFramePath({
    raw: first(params.path),
    fallback: firstPageUrl(tree) ?? '/',
  })
  const viewport = formatViewportParam(parseViewportParam(first(params.vp)))
  return <ProtoChrome tree={tree} initialPath={initialPath} initialViewport={viewport} />
}
