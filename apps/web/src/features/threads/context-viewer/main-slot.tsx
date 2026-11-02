'use client'

import type { ReactNode } from 'react'

import { useThreadPanel } from '../panel/thread-panel-context'
import { ContextViewer } from './context-viewer'
import { FileViewer } from './file-viewer'
import { useEscapeClose } from './use-escape-close'

export function ThreadMainSlot({ children, footer }: { children: ReactNode; footer: ReactNode }) {
  const { contextPath, closeContextFile, filePath, closeFile } = useThreadPanel()
  const open = contextPath !== undefined || filePath !== undefined
  const handleClose = filePath === undefined ? closeContextFile : closeFile
  useEscapeClose({ active: open, onClose: handleClose })

  return (
    <>
      <div className="min-h-0 flex-1">
        <div hidden={open} className="h-full">
          {children}
        </div>
        {filePath === undefined ? null : <FileViewer key={filePath} path={filePath} />}
        {contextPath === undefined || filePath !== undefined ? null : (
          <ContextViewer key={contextPath} path={contextPath} />
        )}
      </div>
      <div hidden={open}>{footer}</div>
    </>
  )
}
