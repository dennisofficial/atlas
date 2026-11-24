import React from 'react'

import { ListPanel } from '../ui/components/list-panel'
import type { McpPanel } from './mcp-panel'
import type { SkillsPanel } from './skills-panel'

const SKILL_HINTS = [
  { key: '↑↓', label: 'pick' },
  { key: '⏎', label: 'put it in the composer' },
  { key: 'esc', label: 'close' },
]

const MCP_HINTS = [
  { key: '↑↓', label: 'pick' },
  { key: '⏎', label: 'open' },
  { key: 'esc', label: 'close' },
]

export function PanelsScreen(props: {
  width: number
  skills: SkillsPanel
  mcp: McpPanel
}): React.ReactNode {
  if (props.skills.panel.open) {
    return (
      <ListPanel
        title="skills"
        rows={props.skills.rows}
        index={props.skills.panel.index}
        width={props.width}
        empty="this session has no skills"
        hints={SKILL_HINTS}
        onPick={props.skills.handlePick}
      />
    )
  }

  if (!props.mcp.panel.open) return null

  return (
    <ListPanel
      title="mcp"
      rows={props.mcp.rows}
      index={props.mcp.panel.index}
      width={props.width}
      empty="this session has no MCP servers"
      hints={MCP_HINTS}
      onPick={props.mcp.handlePick}
    />
  )
}
