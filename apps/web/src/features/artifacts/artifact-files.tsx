'use client'

import { useState } from 'react'
import { FileIcon, FolderIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import type { ArtifactEntry, ArtifactSummary } from '@dltech/atlas-wire'

import {
  artifactFileTree,
  entriesOfTree,
  type ArtifactFileNode,
  type ArtifactTree,
} from './artifact-file-tree'
import { baseUrlOf, fileHrefOf, formatBytes, truncateMiddle } from './artifact-format'

const TREES: readonly ArtifactTree[] = ['dist', 'src']

function FileRow({ node, baseUrl }: { node: ArtifactFileNode; baseUrl: string }) {
  const label = (
    <span className="truncate font-mono" title={node.path}>
      {truncateMiddle(node.name)}
    </span>
  )

  return (
    <li className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5 py-1 pr-2 text-xs">
        {node.entry === null ? (
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        {node.entry === null ? (
          label
        ) : (
          <a
            href={fileHrefOf({ baseUrl, path: node.entry.path })}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 truncate underline-offset-4 hover:underline"
          >
            {label}
          </a>
        )}
        {node.entry === null ? null : (
          <span className="ml-auto flex shrink-0 items-center gap-2 pl-2 text-muted-foreground">
            <span className="hidden sm:inline">{node.entry.type}</span>
            <span>{formatBytes(node.entry.size)}</span>
          </span>
        )}
      </div>
      {node.children.length === 0 ? null : (
        <ul className="ml-1.5 border-l border-border pl-3">
          {node.children.map((child) => (
            <FileRow key={child.path} node={child} baseUrl={baseUrl} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function ArtifactFiles({
  artifact,
  manifest,
}: {
  artifact: ArtifactSummary
  manifest: readonly ArtifactEntry[]
}) {
  const [tree, setTree] = useState<ArtifactTree>('dist')
  const entries = entriesOfTree({ manifest, tree })
  const nodes = artifactFileTree(entries)
  const baseUrl = baseUrlOf(artifact.url)

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Files</h2>
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">File tree</legend>
          {TREES.map((option) => (
            <Button
              key={option}
              size="xs"
              variant={tree === option ? 'secondary' : 'ghost'}
              aria-pressed={tree === option}
              onClick={() => setTree(option)}
            >
              {option}
            </Button>
          ))}
        </fieldset>
      </div>
      {nodes.length === 0 ? (
        <p className="text-xs text-muted-foreground">This version has no {tree} files.</p>
      ) : (
        <ul className="min-w-0 overflow-hidden rounded-xl border border-border px-3 py-2">
          {nodes.map((node) => (
            <FileRow key={node.path} node={node} baseUrl={baseUrl} />
          ))}
        </ul>
      )}
    </section>
  )
}
