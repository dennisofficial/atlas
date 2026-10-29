import { GitBranchIcon } from 'lucide-react'
import { useState } from 'react'

import { PrBell, PrChecks, PrStateIcon } from '../pr-parts'
import { pullRequestsOf, toggleWatched } from '../pull-request-model'
import { DetailsSection } from './section'

const BRANCH = 'dennis/shadcn-ui-storybook'

export function GithubSection() {
  const [prs, setPrs] = useState(() => pullRequestsOf(3).filter((pr) => pr.number !== 1467))

  const handleToggle = (number: number) => setPrs((held) => toggleWatched({ prs: held, number }))

  return (
    <DetailsSection title="GitHub">
      <p className="flex min-w-0 items-center gap-2 px-1 font-mono text-xs text-muted-foreground">
        <GitBranchIcon aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{BRANCH}</span>
      </p>
      {prs.map((pr) => (
        <div
          key={pr.number}
          className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/50"
        >
          <PrStateIcon state={pr.state} />
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="flex min-w-0 flex-1 items-baseline gap-1.5 rounded-sm text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span className="font-medium tabular-nums">#{pr.number}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{pr.branch}</span>
          </a>
          <span className="flex shrink-0 flex-col items-end text-xs">
            <PrChecks pr={pr} />
            {pr.conflicts ? <span className="text-muted-foreground">conflicts</span> : null}
          </span>
          <PrBell pr={pr} size="icon-xs" onToggle={() => handleToggle(pr.number)} />
        </div>
      ))}
    </DetailsSection>
  )
}
