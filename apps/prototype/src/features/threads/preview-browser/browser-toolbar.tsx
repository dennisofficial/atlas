import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LockIcon,
  RotateCwIcon,
} from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@dltech/atlas-ui/components/input-group'

import {
  canGoBack,
  canGoForward,
  currentUrlOf,
  NEW_TAB_URL,
  type BrowserTab,
} from './browser-model'
import { displayUrlOf } from './preview-sites'

function AddressBar({ url, onSubmit }: { url: string; onSubmit: (input: string) => void }) {
  const [draft, setDraft] = useState(displayUrlOf(url))
  const secure = url.startsWith('https://')
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit(draft)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return
    setDraft(displayUrlOf(url))
    event.currentTarget.blur()
  }
  return (
    <form className="min-w-0 flex-1" onSubmit={handleSubmit}>
      <InputGroup>
        <InputGroupAddon>{secure ? <LockIcon /> : <GlobeIcon />}</InputGroupAddon>
        <InputGroupInput
          aria-label="Address"
          value={draft}
          placeholder="Port, path or URL"
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={handleKeyDown}
          className="font-mono text-xs"
        />
      </InputGroup>
    </form>
  )
}

export function BrowserToolbar(props: {
  tab: BrowserTab
  deviceMenu: ReactNode
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onAddress: (input: string) => void
}) {
  const { tab, deviceMenu, onBack, onForward, onReload, onAddress } = props
  const url = currentUrlOf(tab)
  const isNewTab = url === NEW_TAB_URL
  return (
    <div className="flex h-10 shrink-0 items-center gap-0.5 border-b px-1.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Back"
        disabled={!canGoBack(tab)}
        onClick={onBack}
      >
        <ArrowLeftIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Forward"
        disabled={!canGoForward(tab)}
        onClick={onForward}
      >
        <ArrowRightIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Reload"
        disabled={isNewTab}
        onClick={onReload}
      >
        <RotateCwIcon />
      </Button>
      <AddressBar key={`${tab.id}|${url}`} url={url} onSubmit={onAddress} />
      {deviceMenu}
      {isNewTab ? null : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open in your browser"
          nativeButton={false}
          render={<a href={url} target="_blank" rel="noreferrer noopener" />}
        >
          <ExternalLinkIcon />
        </Button>
      )}
    </div>
  )
}
