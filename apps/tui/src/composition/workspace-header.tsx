import React from 'react'

import { HeaderBar } from '../ui/components/header-bar'
import type { DiffStat } from '../ui/header-bar'

export function workspaceHeader(args: {
  welcome: boolean
  width: number
  projectDirectory: string
  repoRoot: string
  diff: DiffStat | null
}): React.ReactNode {
  if (args.welcome) return null
  return (
    <HeaderBar
      width={args.width}
      projectDirectory={args.projectDirectory}
      repoRoot={args.repoRoot}
      diff={args.diff}
    />
  )
}
