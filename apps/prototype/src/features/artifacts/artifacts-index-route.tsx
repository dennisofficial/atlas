import Link from 'next/link'

import { PROTO_ARTIFACTS } from './artifacts-fixtures'

export function ArtifactsIndexRoute() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-16">
      <h1 className="text-xl font-medium tracking-tight">Artifacts</h1>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {PROTO_ARTIFACTS.map((artifact) => (
          <li
            key={artifact.slug}
            className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card"
          >
            <div className="flex aspect-[16/10] w-full items-center justify-center border-b border-border bg-muted/40 text-xs text-muted-foreground">
              live preview
            </div>
            <div className="flex min-w-0 flex-col gap-1 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium">{artifact.name}</span>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                  {artifact.status}
                </span>
              </div>
              <span className="truncate font-mono text-xs text-muted-foreground">
                https://{artifact.slug}.byatlas.site
              </span>
            </div>
            <Link
              href={`/artifacts/${artifact.slug}`}
              aria-label={`Open ${artifact.name}`}
              className="absolute inset-0 rounded-xl outline-none"
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
