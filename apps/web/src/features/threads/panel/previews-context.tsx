'use client'

import { createContext, useContext } from 'react'

import { EMPTY_PREVIEWS, type PreviewsState } from '../data/use-previews'

const PreviewsContext = createContext<PreviewsState>(EMPTY_PREVIEWS)

export const PreviewsProvider = PreviewsContext.Provider

export const usePreviewsContext = (): PreviewsState => useContext(PreviewsContext)
