'use client'

import { useState } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'

import { Button } from '@dltech/atlas-ui/components/button'

export function CopyButton({
  value,
  label,
  text,
}: {
  value: string
  label: string
  text?: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard?.writeText(value)?.catch(() => undefined)
    setCopied(true)
  }

  const Icon = copied ? CheckIcon : CopyIcon

  if (text !== undefined) {
    return (
      <Button size="sm" variant="outline" aria-label={label} title={label} onClick={handleCopy}>
        <Icon data-icon="inline-start" />
        {text}
      </Button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      onClick={handleCopy}
      type="button"
    >
      <Icon />
    </Button>
  )
}
