'use client'

import type { ReactNode } from 'react'

import { useThreadPanel } from '../panel/thread-panel-context'
import { ContextViewer } from './context-viewer'
import { useEscapeClose } from './use-escape-close'

export function ThreadMainSlot({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  const { contextPath, closeContextFile } = useThreadPanel()
  useEscapeClose({ active: contextPath !== undefined, onClose: closeContextFile })

  const open = contextPath !== undefined
  return (
    <>
      <div className="min-h-0 flex-1">
        <div hidden={open} className="h-full">
          {children}
        </div>
        {open ? <ContextViewer key={contextPath} path={contextPath} /> : null}
      </div>
      <div hidden={open}>{footer}</div>
    </>
  )
}
