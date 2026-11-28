'use client'

import { createContext, useContext, type ReactNode } from 'react'

const FileIconsContext = createContext(false)

export function FileIconsProvider({
  colored,
  children,
}: {
  colored: boolean
  children: ReactNode
}) {
  return <FileIconsContext.Provider value={colored}>{children}</FileIconsContext.Provider>
}

export function useColoredFileIcons(): boolean {
  return useContext(FileIconsContext)
}
