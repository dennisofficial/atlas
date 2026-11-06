import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LockIcon,
  RotateCwIcon,
} from 'lucide-react'

import { Button } from '#components/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '#components/input-group'

interface AddressBarProps {
  address: string
  onSubmit: (input: string) => void
}

function AddressBar({ address, onSubmit }: AddressBarProps) {
  const [draft, setDraft] = useState(address)
  const secure = address.startsWith('https://')
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit(draft)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Escape') return
    setDraft(address)
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

function LoadingBar() {
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden"
    >
      <div className="h-full w-1/3 animate-[preview-loading_1.2s_ease-in-out_infinite] bg-primary motion-reduce:w-full motion-reduce:animate-pulse" />
    </div>
  )
}

export interface PreviewToolbarProps {
  activeId?: string
  address: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  canReload: boolean
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onAddress: (input: string) => void
  deviceMenu: ReactNode
}

export function PreviewToolbar({
  activeId,
  address,
  loading,
  canGoBack,
  canGoForward,
  canReload,
  onBack,
  onForward,
  onReload,
  onAddress,
  deviceMenu,
}: PreviewToolbarProps) {
  return (
    <div className="relative flex h-10 shrink-0 items-center gap-0.5 border-b px-1.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Back"
        disabled={!canGoBack}
        onClick={onBack}
      >
        <ArrowLeftIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Forward"
        disabled={!canGoForward}
        onClick={onForward}
      >
        <ArrowRightIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Reload"
        disabled={!canReload}
        onClick={onReload}
      >
        <RotateCwIcon />
      </Button>
      <AddressBar key={`${activeId ?? ''}|${address}`} address={address} onSubmit={onAddress} />
      {deviceMenu}
      {address === '' ? null : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open in your browser"
          nativeButton={false}
          render={<a href={address} target="_blank" rel="noreferrer noopener" />}
        >
          <ExternalLinkIcon />
        </Button>
      )}
      {loading ? <LoadingBar /> : null}
    </div>
  )
}
