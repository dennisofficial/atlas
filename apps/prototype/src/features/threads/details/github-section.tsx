import { GitBranchIcon } from 'lucide-react'
import { useState } from 'react'

import { DetailRow } from '@dltech/atlas-ui/ai/detail-row'

import { PrBell, PrChecks, PrStateIcon } from '../pr-parts'
import { pullRequestsOf, toggleWatched } from '../pull-request-model'
import { DetailsSection } from './section'

const BRANCH = 'dennis/shadcn-ui-storybook'

export function GithubSection() {
  const [prs, setPrs] = useState(() => pullRequestsOf(3).filter((pr) => pr.number !== 1467))

  const handleToggle = (number: number) => setPrs((held) => toggleWatched({ prs: held, number }))

  return (
    <DetailsSection title="GitHub">
      <DetailRow label={BRANCH} icon={<GitBranchIcon aria-hidden className="size-3.5" />} mono />
      {prs.map((pr) => (
        <DetailRow
          key={pr.number}
          icon={<PrStateIcon state={pr.state} />}
          label={
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="font-medium tabular-nums">#{pr.number}</span>{' '}
              <span className="font-mono text-xs text-muted-foreground">{pr.branch}</span>
            </a>
          }
          meta={
            <span className="flex flex-col items-end">
              <PrChecks pr={pr} />
              {pr.conflicts ? <span>conflicts</span> : null}
            </span>
          }
          actions={<PrBell pr={pr} size="icon-xs" onToggle={() => handleToggle(pr.number)} />}
        />
      ))}
    </DetailsSection>
  )
}
