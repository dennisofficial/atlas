'use client'

import { useState } from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@dltech/atlas-ui/components/button'
import { REAUTH_REQUIRED_CODE } from '@dltech/atlas-wire/web'

import { CloudApiError } from '@/lib/cloud-api'

import { ReauthDialog } from './reauth-dialog'

const MASK = '••••••••••••'

export function SecretValueCell({
  name,
  fetchValue,
  className,
}: {
  name: string
  fetchValue: () => Promise<string>
  className?: string
}) {
  const [value, setValue] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [reauthOpen, setReauthOpen] = useState(false)
  const revealed = value !== null
  const Icon = revealed ? EyeOffIcon : EyeIcon

  const reveal = async () => {
    setLoading(true)
    try {
      setValue(await fetchValue())
    } catch (failure) {
      if (failure instanceof CloudApiError && failure.code === REAUTH_REQUIRED_CODE) {
        setReauthOpen(true)
      } else {
        toast.error('Could not reveal value')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = () => {
    if (revealed) setValue(null)
    else void reveal()
  }

  return (
    <span className={className ?? 'flex min-w-0 items-center gap-1'}>
      <span className="truncate font-mono text-xs text-muted-foreground">{value ?? MASK}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={loading}
        aria-label={`${revealed ? 'Hide' : 'Reveal'} ${name}`}
        aria-pressed={revealed}
        onClick={handleToggle}
      >
        <Icon />
      </Button>
      <ReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        onConfirmed={() => void reveal()}
      />
    </span>
  )
}
