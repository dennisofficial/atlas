'use client'

import { useEffect, useState } from 'react'

import { NO_VISITS, recordDeparture, type CrewVisits } from '@dltech/atlas-client/crew'

export function useCrewVisits(viewing: string | null): CrewVisits {
  const [visits, setVisits] = useState<CrewVisits>(NO_VISITS)

  useEffect(() => {
    if (viewing === null) return undefined
    return () =>
      setVisits((held) =>
        recordDeparture({ visits: held, leaving: viewing, at: new Date().toISOString() }),
      )
  }, [viewing])

  return visits
}
