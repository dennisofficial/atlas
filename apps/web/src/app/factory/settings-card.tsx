'use client'

import { Badge } from '@dltech/atlas-ui/badge'
import { Button } from '@dltech/atlas-ui/button'
import { Card } from '@dltech/atlas-ui/card'
import { Input } from '@dltech/atlas-ui/input'
import { useState, type FormEvent } from 'react'

import {
  saveDecisionsSettings,
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
  const [decisionsBusy, setDecisionsBusy] = useState(false)
  const [decisionsError, setDecisionsError] = useState<string | null>(null)
  const [decisionsSaved, setDecisionsSaved] = useState(false)

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

  const handleDecisionsSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const url = String(form.get('decisions-url') ?? '').trim()
    const token = String(form.get('decisions-token') ?? '').trim()

    setDecisionsBusy(true)
    setDecisionsError(null)
    setDecisionsSaved(false)
    try {
      await saveDecisionsSettings({ url, ...(token.length === 0 ? {} : { token }) })
      formElement.reset()
      setDecisionsSaved(true)
      await onSaved()
    } catch (cause) {
      setDecisionsError(cause instanceof Error ? cause.message : 'Could not save the decision model')
    } finally {
      setDecisionsBusy(false)
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
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-foreground">Decision model</span>
            <Badge tone={settings.decisions.configured ? 'success' : 'neutral'} dot>
              {settings.decisions.configured ? 'configured' : 'not configured'}
            </Badge>
            {settings.decisions.hasToken ? <Badge tone="success">key stored</Badge> : null}
          </div>
          {settings.decisions.url !== null ? (
            <span className="font-mono text-xs text-meta">{settings.decisions.url}</span>
          ) : null}
          <form onSubmit={handleDecisionsSubmit} className="flex flex-col gap-3">
            <Input
              name="decisions-url"
              label="Decisions endpoint"
              placeholder="https://api.typesafe.ai"
              required
            />
            <Input
              name="decisions-token"
              type="password"
              label="Decision key (optional — a self-hosted Laya ignores it)"
              placeholder="Paste the Jev key"
              autoComplete="off"
            />
            {decisionsError !== null ? (
              <p className="text-xs text-destructive">{decisionsError}</p>
            ) : null}
            {decisionsSaved ? <p className="text-xs text-success">Decision model saved.</p> : null}
            <Button type="submit" variant="primary" loading={decisionsBusy}>
              Save decision model
            </Button>
          </form>
        </div>
      </div>
    </Card>
  )
}
