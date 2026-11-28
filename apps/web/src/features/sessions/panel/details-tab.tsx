'use client'

import { useCallback, useState } from 'react'

import { ContextFileView } from '../files/context-file-view'
import { recallDetailsFile, rememberDetailsFile } from './pane-memory'
import { useSessionPaneValue } from './pane-value'
import { SessionBackgroundSection } from './details/background-section'
import { SessionContextSection } from './details/context-section'
import { SessionCrewSection } from './details/crew-section'
import { SessionGithubSection } from './details/github-section'
import { SessionDetailsHeader } from './details/header-section'
import { SessionPodSection } from './details/pod-section'
import { SessionServicesSection } from './details/services-section'
import { SessionSubscriptionsSection } from './details/subscriptions-section'
import { SessionTodoSection } from './details/todo-section'

export function SessionDetailsTab() {
  const { sessionId, view } = useSessionPaneValue()
  const [contextPath, setContextPathState] = useState(() => recallDetailsFile(sessionId))
  const setContextPath = useCallback(
    (path: string | undefined) => {
      rememberDetailsFile({ sessionId, path })
      setContextPathState(path)
    },
    [sessionId],
  )
  const handleBack = () => setContextPath(undefined)

  if (contextPath !== undefined) {
    return (
      <div data-session-details className="flex min-h-0 flex-1 flex-col">
        <ContextFileView sessionId={sessionId} path={contextPath} onBack={handleBack} />
      </div>
    )
  }

  return (
    <div
      data-session-details
      className="@container flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 py-3"
    >
      <SessionDetailsHeader />
      <SessionPodSection />
      <div data-session-todo-slot className="contents">
        <SessionTodoSection tasks={view.plan} />
      </div>
      <SessionGithubSection />
      <SessionContextSection onOpenFile={setContextPath} />
      <SessionSubscriptionsSection />
      <SessionServicesSection />
      <SessionCrewSection />
      <SessionBackgroundSection />
    </div>
  )
}
