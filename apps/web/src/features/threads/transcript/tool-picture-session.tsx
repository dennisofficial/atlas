'use client'

import { createContext, useContext } from 'react'

const ToolPictureSessionContext = createContext<string | null>(null)

export const ToolPictureSessionProvider = ToolPictureSessionContext.Provider

export const useToolPictureSession = (): string | null => useContext(ToolPictureSessionContext)
