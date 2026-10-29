import { XIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@dltech/atlas-ui/components/button'

import { GRANTS } from './details-fixtures'
import { DetailsSection } from './section'

export function GrantsSection() {
  const [grants, setGrants] = useState(GRANTS)
  if (grants.length === 0) return null

  const handleRevoke = (id: string) => setGrants((held) => held.filter((grant) => grant.id !== id))

  return (
    <DetailsSection title="Grants" count={grants.length}>
      {grants.map((grant) => (
        <div key={grant.id} className="flex items-center gap-2 px-1 py-0.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-mono text-sm">{grant.subject}</span>
            <span className="truncate text-xs text-muted-foreground">
              {grant.dimensions.join(', ')}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Revoke ${grant.subject}`}
            onClick={() => handleRevoke(grant.id)}
          >
            <XIcon />
          </Button>
        </div>
      ))}
    </DetailsSection>
  )
}
