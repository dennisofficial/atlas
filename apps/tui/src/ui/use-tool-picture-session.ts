import { useEffect } from 'react'

import { applyToolPictureSession, type ToolPictureSession } from './tool-picture-store'

type ToolPictureApi = Pick<ToolPictureSession, 'mediaUrl'>

export function useToolPictureSession(args: { api: ToolPictureApi; sessionId: string }): void {
  const { api, sessionId } = args
  useEffect(() => {
    applyToolPictureSession({ sessionId, mediaUrl: api.mediaUrl })
    return () => applyToolPictureSession(undefined)
  }, [api, sessionId])
}
