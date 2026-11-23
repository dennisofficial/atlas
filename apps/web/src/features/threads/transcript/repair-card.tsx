'use client'

import type { RunAttentionAction } from '@dltech/atlas-ui/ai/run-attention-strip'

import { RunFailureCard } from './run-failure-card'

export type RepairCardProps = {
  title: string
  detail: string
  notes: readonly string[]
  actions: readonly RunAttentionAction[]
}

export function RepairCard({ title, detail, notes, actions }: RepairCardProps) {
  return <RunFailureCard title={title} detail={detail} notes={notes} actions={actions} />
}
