'use client'

import { useParams } from 'next/navigation'

import { PROTO_ARTIFACTS } from './artifacts-fixtures'

export function ArtifactsDetailRoute() {
  const params = useParams<{ slug: string }>()
  const artifact = PROTO_ARTIFACTS.find((candidate) => candidate.slug === params.slug)
  if (artifact === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No artifact with slug {params.slug}
      </div>
    )
  }
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-10">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="truncate text-xl font-medium tracking-tight">{artifact.name}</h1>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {artifact.status}
        </span>
      </header>
      <p className="truncate font-mono text-xs text-muted-foreground">
        https://{artifact.slug}.byatlas.site
      </p>
      <div className="flex aspect-[16/10] w-full items-center justify-center rounded-xl border border-border bg-muted/40 text-xs text-muted-foreground">
        live artifact in a rounded frame
      </div>
    </div>
  )
}
