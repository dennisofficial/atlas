'use client'

import { Suspense } from 'react'

import { useBrowserReturnReader } from './use-browser-return-reader'

function BrowserReturnRead() {
  useBrowserReturnReader()
  return null
}

export function BrowserReturnReader() {
  return (
    <Suspense fallback={null}>
      <BrowserReturnRead />
    </Suspense>
  )
}
