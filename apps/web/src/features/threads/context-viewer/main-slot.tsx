'use client'

import type { ReactNode } from 'react'

import { useThreadPanel } from '../panel/thread-panel-context'
import { ContextViewer } from './context-viewer'
import { useEscapeClose } from './use-escape-close'

export function ThreadMainSlot({ children }: { children: ReactNode }) {
  const { contextPath, closeContextFile } = useThreadPanel()
  useEscapeClose({ active: contextPath !== undefined, onClose: closeContextFile })

  return (
    <div className="min-h-0 flex-1">
      <div hidden={contextPath !== undefined} className="h-full">
        {children}
      </div>
      {contextPath === undefined ? null : <ContextViewer key={contextPath} path={contextPath} />}
    </div>
  )
}
