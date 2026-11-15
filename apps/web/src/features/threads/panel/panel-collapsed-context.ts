import { createContext, useContext } from 'react'

const PanelCollapsedContext = createContext(false)

export const PanelCollapsedProvider = PanelCollapsedContext.Provider

export const usePanelCollapsed = (): boolean => useContext(PanelCollapsedContext)
