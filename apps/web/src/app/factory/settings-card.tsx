'use client'

import { Badge } from '@dltech/atlas-ui/badge'
import { Button } from '@dltech/atlas-ui/button'
import { Card } from '@dltech/atlas-ui/card'
import { Input } from '@dltech/atlas-ui/input'
import { useState, type FormEvent } from 'react'

import {
  saveModelSettings,
  saveVercelSettings,
  type FactorySettings,
} from '../../lib/factory-api'

type SettingsCardProps = {
  settings: FactorySettings | null
  organizationMissing: boolean
  onSaved: () => Promise<void>
}

const SOURCE_TONES: Record<FactorySettings['model']['source'], 'success' | 'warning' | 'neutral'> = {
  organization: 'success',
  environment: 'warning',
  unconfigured: 'neutral',
}

export function SettingsCard({ settings, organizationMissing, onSaved }: SettingsCardProps) {
  const [modelBusy, setModelBusy] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [modelSaved, setModelSaved] = useState(false)
  const [vercelBusy, setVercelBusy] = useState(false)
  const [vercelError, setVercelError] = useState<string | null>(null)
  const [vercelSaved, setVercelSaved] = useState(false)

  const handleModelSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const modelRef = String(form.get('model-ref') ?? '').trim()
    const apiKey = String(form.get('model-api-key') ?? '').trim()

    setModelBusy(true)
    setModelError(null)
    setModelSaved(false)
    try {
      await saveModelSettings({ apiKey, modelRef })
      formElement.reset()
      setModelSaved(true)
      await onSaved()
    } catch (cause) {
      setModelError(cause instanceof Error ? cause.message : 'Could not save model settings')
    } finally {
      setModelBusy(false)
    }
  }

  const handleVercelSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const token = String(form.get('vercel-token') ?? '').trim()

    setVercelBusy(true)
    setVercelError(null)
    setVercelSaved(false)
    try {
      await saveVercelSettings({ token })
      formElement.reset()
      setVercelSaved(true)
      await onSaved()
    } catch (cause) {
      setVercelError(cause instanceof Error ? cause.message : 'Could not save the Vercel token')
    } finally {
      setVercelBusy(false)
    }
  }

  if (organizationMissing || settings === null) {
    return (
      <Card title="Model & keys" subtitle="Inference and deploy credentials">
        <p className="text-sm text-meta">
          Select or create an active organization to manage model settings.
        </p>
      </Card>
    )
  }

  return (
    <Card title="Model & keys" subtitle="Inference and deploy credentials">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground">
              Current model:{' '}
              <span className="font-mono text-xs">{settings.model.modelRef}</span>
            </span>
            <Badge tone={SOURCE_TONES[settings.model.source]}>{settings.model.source}</Badge>
            {settings.model.hasApiKey ? <Badge tone="success">key stored</Badge> : null}
          </div>
          <form onSubmit={handleModelSubmit} className="flex flex-col gap-3">
            <Input
              name="model-ref"
              label="Model reference"
              placeholder="inference/kimi-k3-fast"
              required
            />
            <Input
              name="model-api-key"
              type="password"
              label="API key"
              placeholder="Paste the provider key"
              required
              autoComplete="off"
            />
            {modelError !== null ? (
              <p className="text-xs text-destructive">{modelError}</p>
            ) : null}
            {modelSaved ? <p className="text-xs text-success">Model settings saved.</p> : null}
            <Button type="submit" variant="primary" loading={modelBusy}>
              Save model settings
            </Button>
          </form>
        </div>
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground">Vercel</span>
            <Badge tone={settings.vercel.connected ? 'success' : 'neutral'} dot>
              {settings.vercel.connected ? 'connected' : 'not connected'}
            </Badge>
          </div>
          <form onSubmit={handleVercelSubmit} className="flex flex-col gap-3">
            <Input
              name="vercel-token"
              type="password"
              label="Vercel token"
              placeholder="Paste a Vercel access token"
              required
              autoComplete="off"
            />
            {vercelError !== null ? (
              <p className="text-xs text-destructive">{vercelError}</p>
            ) : null}
            {vercelSaved ? <p className="text-xs text-success">Vercel token saved.</p> : null}
            <Button type="submit" variant="primary" loading={vercelBusy}>
              Save Vercel token
            </Button>
          </form>
        </div>
      </div>
    </Card>
  )
}
