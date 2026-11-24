import type { KeyEvent } from '@opentui/core'
import React, { useCallback, useRef } from 'react'

import type { Event, V2Event } from '@dltech/atlas-core'

import type { McpPanel } from './mcp-panel'
import { useMcpPanel } from './mcp-panel'
import { PanelsScreen } from './panels-screen'
import type { SessionApi } from './session-api'
import type { SkillsPanel } from './skills-panel'
import { useSkillsPanel } from './skills-panel'

export type TranscriptPanels = {
  skills: SkillsPanel
  mcp: McpPanel
  handleKey: (key: KeyEvent) => boolean
  render: (width: number) => React.ReactNode
}

export function useTranscriptPanels(args: {
  api: SessionApi
  views: Readonly<Record<string, unknown>>
  events: readonly (Event | V2Event)[]
  openUrl: (url: string) => void
  onProblem: (reason: string) => void
  onComplete: (name: string) => void
}): TranscriptPanels {
  const skills = useSkillsPanel({
    api: args.api,
    onProblem: args.onProblem,
    onComplete: args.onComplete,
  })
  const mcp = useMcpPanel({
    api: args.api,
    views: args.views,
    events: args.events,
    openUrl: args.openUrl,
    onProblem: args.onProblem,
  })

  const skillsKey = useRef(skills.handleKey)
  skillsKey.current = skills.handleKey
  const mcpKey = useRef(mcp.handleKey)
  mcpKey.current = mcp.handleKey

  const handleKey = useCallback(
    (key: KeyEvent): boolean => skillsKey.current(key) || mcpKey.current(key),
    [],
  )

  const render = useCallback(
    (width: number) => <PanelsScreen width={width} skills={skills} mcp={mcp} />,
    [mcp, skills],
  )

  return { skills, mcp, handleKey, render }
}
