import type { ApiClient } from '@dltech/atlas-api-router'
import { usageProviderOf } from '@dltech/atlas-core'
import { type UsageReportDto, usageReportDtoSchema } from '@dltech/atlas-protocol'
import { useEffect, useRef, useState } from 'react'

const useTurnEnds = (working: boolean): number => {
  const [turnEnds, setTurnEnds] = useState(0)
  const wasWorking = useRef(false)

  useEffect(() => {
    if (working) {
      wasWorking.current = true
      return
    }
    if (!wasWorking.current) return
    wasWorking.current = false
    setTurnEnds((count) => count + 1)
  }, [working])

  return turnEnds
}

export const usePlanUsage = (args: {
  api: ApiClient | undefined
  modelRef: string | null
  working: boolean
}): UsageReportDto | null => {
  const provider = args.modelRef === null ? null : usageProviderOf({ ref: args.modelRef })
  const [report, setReport] = useState<UsageReportDto | null>(null)
  const turnEnds = useTurnEnds(args.working)

  useEffect(() => {
    if (args.api === undefined || provider === null) {
      setReport(null)
      return
    }
    let cancelled = false
    void args.api.usage.report
      .query({ provider })
      .then((response) => {
        if (!cancelled) setReport(usageReportDtoSchema.parse(response))
      })
      .catch(() => {
        if (!cancelled) setReport(null)
      })
    return () => {
      cancelled = true
    }
  }, [args.api, provider, turnEnds])

  return report
}
