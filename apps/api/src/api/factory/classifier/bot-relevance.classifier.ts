import { Injectable, Logger } from '@nestjs/common'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { z } from 'zod'
import { EnvService } from '../../../_core/config/env/env.service'
import { OrgSettingsService } from '../settings/org-settings.service'

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

const CLASSIFIER_MODEL_ID = 'claude-haiku-4-5'

const verdictSchema = z.object({
  needsAgent: z.boolean(),
})

const SYSTEM_PROMPT = [
  'You are the intake filter for an autonomous software engineer (the Atlas factory orchestrator).',
  'A bot or integration just commented on a pull request or ticket the engineer is actively working.',
  'Decide whether the engineer needs to see this comment to do the work.',
  '',
  'The engineer NEEDS it when it carries a fact that changes the work: a failed deploy or CI, a',
  'code-review finding, a security flag, a reproduction, a correction, a requested change.',
  'The engineer does NOT need pure noise: a successful deploy ping, a status heartbeat, a',
  'lgtm-style approval with no content, a sync or link-back notice.',
  '',
  'When in doubt, say the engineer needs it — a missed signal costs more than an extra glance.',
].join('\n')

type Verdict = z.infer<typeof verdictSchema>

/**
 * The bot-noise gate. A bot/integration comment on a tracked surface is read for "does the working
 * engineer need this" before it wakes the orchestrator; humans never pass through here. The call
 * is fail-open — any classifier error wakes the loop, because a suppressed signal is the failure
 * that matters and an unnecessary wake is cheap.
 */
@Injectable()
export class BotRelevanceClassifier {
  private readonly logger = new Logger(BotRelevanceClassifier.name)

  /** Overridable for specs — production uses the real model call. */
  classify: (args: { apiKey: string; modelId: string; text: string }) => Promise<Verdict> =
    defaultClassify

  constructor(
    private readonly env: EnvService,
    private readonly settings: OrgSettingsService,
  ) {}

  /** True when the comment should wake the working agent. */
  async shouldWake(args: {
    organizationId: string | null
    author: string
    body: string
  }): Promise<boolean> {
    const credential = await this.credential(args.organizationId)
    if (credential === null) {
      this.logger.warn('no classifier credential; waking on the bot comment')
      return true
    }
    try {
      const verdict = await this.classify({
        apiKey: credential.apiKey,
        modelId: credential.modelId,
        text: `bot author: ${args.author}\n\n${args.body}`,
      })
      return verdict.needsAgent
    } catch (failure) {
      this.logger.warn(`bot-relevance classifier failed open: ${messageOf(failure)}`)
      return true
    }
  }

  private async credential(
    organizationId: string | null,
  ): Promise<{ apiKey: string; modelId: string } | null> {
    if (organizationId !== null) {
      const blob = await this.settings.readModelCredential({ organizationId })
      if (blob !== null) return { apiKey: blob.apiKey, modelId: blob.modelRef.split('/').pop() ?? CLASSIFIER_MODEL_ID }
    }
    const apiKey = this.env.get('FACTORY_MODEL_API_KEY')
    if (apiKey === undefined || apiKey.length === 0) return null
    return { apiKey, modelId: this.env.get('FACTORY_MODEL_ID') ?? CLASSIFIER_MODEL_ID }
  }
}

async function defaultClassify(args: {
  apiKey: string
  modelId: string
  text: string
}): Promise<Verdict> {
  const anthropic = createAnthropic({ apiKey: args.apiKey })
  const result = await generateObject({
    model: anthropic(args.modelId),
    schema: verdictSchema,
    system: SYSTEM_PROMPT,
    prompt: args.text,
  })
  return result.object
}
