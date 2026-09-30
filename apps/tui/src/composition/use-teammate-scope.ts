import type { AgentSnapshot, ThreadSummary } from '@dltech/atlas-harness'
import { useEffect, useMemo, useState } from 'react'

import { subagentLabel } from '../store/subagent-row'
import { EThinkingVisibility } from '../store/thinking-fold'
import type { SidebarModel } from '../store/sidebar-model'
import type { AtlasApp } from './compose'
import { EThreadRows, useThreadView } from './use-thread-view'

/**
 * A teammate visited from the main session reads like a session of its own: its workspace and
 * linked pull requests come from its thread record. The name on the roster wins over the record's
 * title because the roster is what the operator clicked.
 */
export function useTeammateThread(args: {
  app: AtlasApp
  teammate: AgentSnapshot | null
}): ThreadSummary | null {
  const { app, teammate } = args
  const [thread, setThread] = useState<ThreadSummary | null>(null)

  useEffect(() => {
    if (teammate === null) {
      setThread(null)
      return
    }

    let mounted = true
    void app.threads.find({ threadId: teammate.agentId }).then((found) => {
      if (mounted) setThread(found ?? null)
    })
    return () => {
      mounted = false
    }
  }, [app.threads, teammate])

  return thread
}

/**
 * The teammate's sidebar model: its own log fold (todo, spend, grants, last activity) with the
 * crew the caller scoped to it merged on top, so its own sub-agents list where the main session's
 * would. The title is the roster's name for it unless its log already named the session.
 */
export function useTeammateSidebar(args: {
  app: AtlasApp
  teammate: AgentSnapshot
  crew: SidebarModel
}): SidebarModel {
  const { app, teammate, crew } = args

  const fold = useThreadView({
    app,
    threadId: teammate.agentId,
    rows: EThreadRows.Own,
    thinking: EThinkingVisibility.Keep,
    readClock: Date.now,
  })

  return useMemo(
    () => ({
      ...fold.sidebar,
      title: fold.sidebar.title ?? subagentLabel(teammate),
      ...(crew.subagents === undefined ? {} : { subagents: crew.subagents }),
      ...(crew.crewFold === undefined ? {} : { crewFold: crew.crewFold }),
      ...(crew.teammates === undefined ? {} : { teammates: crew.teammates }),
    }),
    [crew, fold.sidebar, teammate],
  )
}
