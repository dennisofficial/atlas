'use client'

import { createContext, useContext } from 'react'

const ChromeThemeContext = createContext('proto-chrome')

export const ChromeThemeProvider = ChromeThemeContext.Provider

export function useChromeThemeClass(): string {
  return useContext(ChromeThemeContext)
}
