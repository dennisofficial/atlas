'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { diagramKey, EDiagramRepair } from '@dltech/atlas-core'
import type { DiagramRepairListOutput } from '@dltech/atlas-protocol'
import { parsesAsMermaid } from '@dltech/atlas-ui/lib/mermaid-parse'

import type { RepairDiagramAction } from '@/features/threads/data/diagram-repair'

import { acceptedRepairsOf } from './session-diagram-repairs'
import { diagramsApi, type DiagramsApi } from './sessions-api'

export const REPAIRED_DIAGRAM_DOES_NOT_PARSE = 'the repaired diagram still does not parse'

const NO_REPAIRS: ReadonlyMap<string, string> = new Map()
const NO_VERDICTS: ReadonlyMap<string, boolean> = new Map()

export type DiagramValidator = (source: string) => Promise<boolean>

export type SessionDiagramRepairs = {
  repairs: ReadonlyMap<string, string>
  repairDiagram: RepairDiagramAction
}

export function useSessionDiagramRepairs({
  sessionId,
  api = diagramsApi,
  validate = parsesAsMermaid,
}: {
  sessionId: string
  api?: DiagramsApi
  validate?: DiagramValidator
}): SessionDiagramRepairs {
  const queryClient = useQueryClient()
  const queryKey = useMemo(() => ['session-diagram-repairs', sessionId], [sessionId])
  const query = useQuery({
    queryKey,
    queryFn: () => api.list({ sessionId }),
    staleTime: Infinity,
  })
  const entries = query.data?.repairs
  const [verdicts, setVerdicts] = useState<ReadonlyMap<string, boolean>>(NO_VERDICTS)
  const validations = useRef(new Map<string, Promise<boolean>>())
  const attempts = useRef(new Map<string, Promise<void>>())

  const validateOnce = useCallback(
    (args: { key: string; source: string }): Promise<boolean> => {
      const verdict = verdicts.get(args.key)
      if (verdict !== undefined) return Promise.resolve(verdict)
      const running = validations.current.get(args.key)
      if (running !== undefined) return running
      const started = validate(args.source)
        .catch(() => false)
        .then((valid) => {
          setVerdicts((current) =>
            current.has(args.key) ? current : new Map(current).set(args.key, valid),
          )
          return valid
        })
      validations.current.set(args.key, started)
      return started
    },
    [validate, verdicts],
  )

  useEffect(() => {
    for (const entry of entries ?? []) {
      if (entry.outcome.kind !== EDiagramRepair.Repaired) continue
      void validateOnce({ key: diagramKey(entry.source), source: entry.outcome.repaired })
    }
  }, [entries, validateOnce])

  const repairs = useMemo(
    () =>
      entries === undefined
        ? NO_REPAIRS
        : acceptedRepairsOf(
            entries.map((entry) => ({
              ...entry,
              valid: verdicts.get(diagramKey(entry.source)) === true,
            })),
          ),
    [entries, verdicts],
  )

  const repairDiagram = useCallback<RepairDiagramAction>(
    async ({ chart, error, context }) => {
      const key = diagramKey(chart)
      const settled = attempts.current.get(key)
      if (settled !== undefined) return settled
      const attempt = (async () => {
        const listed = queryClient
          .getQueryData<DiagramRepairListOutput>(queryKey)
          ?.repairs.find((entry) => diagramKey(entry.source) === key)
        const outcome =
          listed?.outcome ??
          (await api.repair({
            sessionId,
            source: chart,
            error,
            ...(context === undefined ? {} : { context }),
          }))
        if (outcome.kind === EDiagramRepair.Failed) throw new Error(outcome.reason)
        const valid = await validateOnce({ key, source: outcome.repaired })
        if (!valid) throw new Error(REPAIRED_DIAGRAM_DOES_NOT_PARSE)
        queryClient.setQueryData<DiagramRepairListOutput>(queryKey, (current) => ({
          repairs: [
            ...(current?.repairs.filter((entry) => diagramKey(entry.source) !== key) ?? []),
            { source: chart, outcome },
          ],
        }))
      })()
      attempts.current.set(key, attempt)
      return attempt
    },
    [api, queryClient, queryKey, sessionId, validateOnce],
  )

  return { repairs, repairDiagram }
}
