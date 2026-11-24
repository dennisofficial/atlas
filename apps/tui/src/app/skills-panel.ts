import type { KeyEvent } from '@opentui/core'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ListPanelRow } from '../ui/components/list-panel'
import type { SessionApi } from './session-api'
import { useOpenPanel, type OpenPanelControl } from './use-open-panel'

export type SkillRow = { name: string; summary: string; argumentHint: string | null }

export type SkillEntry = { name: string; summary: string; argumentHint?: string | undefined }

export type SkillsPanel = OpenPanelControl & {
  rows: readonly ListPanelRow[]
  ready: boolean
  handlePick: (index: number) => void
  handleKey: (key: KeyEvent) => boolean
}

export const skillRowsOf = (skills: readonly SkillEntry[]): readonly SkillRow[] =>
  skills
    .map((skill) => ({
      name: skill.name,
      summary: skill.summary,
      argumentHint: skill.argumentHint ?? null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))

export const skillPanelRowsOf = (rows: readonly SkillRow[]): readonly ListPanelRow[] =>
  rows.map((row) => ({
    key: row.name,
    label: `/${row.name}`,
    detail: row.summary,
    mark: { text: 'skill', tone: 'meta' },
  }))

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export function useSkillsPanel(args: {
  api: SessionApi | null
  onProblem: (reason: string) => void
  onComplete: (name: string) => void
}): SkillsPanel {
  const [skills, setSkills] = useState<readonly SkillRow[]>([])
  const [ready, setReady] = useState(false)
  const problem = useRef(args.onProblem)
  problem.current = args.onProblem
  const { api } = args
  const open = useOpenPanel()

  useEffect(() => {
    if (api === null) return undefined

    let held = true
    void api.skills().then(
      (reply) => {
        if (!held) return
        setSkills(skillRowsOf(reply))
        setReady(true)
      },
      (failure: unknown) => {
        if (!held) return
        setReady(true)
        problem.current(`could not load the skills — ${messageOf(failure)}`)
      },
    )

    return () => {
      held = false
    }
  }, [api])

  const rows = skillPanelRowsOf(skills)

  const handlePick = useCallback(
    (index: number) => {
      const row = rows[index]
      if (row === undefined) return
      open.handleClose()
      args.onComplete(row.key)
    },
    [args, open, rows],
  )

  const handleKey = useCallback(
    (key: KeyEvent): boolean => {
      if (!open.panel.open) return false
      if (key.name === 'escape') {
        open.handleClose()
        return true
      }
      if (open.handleMove(key, rows.length)) return true
      if (key.name === 'return' || key.name === 'enter') {
        handlePick(open.panel.index)
        return true
      }
      return false
    },
    [handlePick, open, rows.length],
  )

  return { ...open, rows, ready, handlePick, handleKey }
}
