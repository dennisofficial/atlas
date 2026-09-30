import { join } from 'node:path'

import {
  EFinishReason,
  ModelPort,
  type Assembled,
  type Chunk,
  type ModelStepResult,
  type ToolDeclaration,
} from '@dltech/atlas-core'

import { portToken, type DependencyContainer } from '../../container/injection'
import {
  ClaudeCodeSourceToken,
  CodexSourceToken,
  KeychainReaderToken,
} from '../../container/tokens'
import { ClaudeCodeSource } from '../../credentials/claude-code-source'
import { CodexSource } from '../../credentials/codex-source'
import type { KeychainReader } from '../../credentials/keychain-reader'

// The fake cloud and the fake provider are deliberately the same shape of dead: every socket a
// local turn might open is refused before any bytes leave, and every refusal is recorded so the
// assertions can name the exact URL nobody was allowed to call.
export const CLOUD_URL = 'https://cloud-unreachable.test'
export const PROVIDER_URL = 'https://api.anthropic.test'

export type RecordedRequest = { url: string; authorization: string | undefined }

export const requests: RecordedRequest[] = []

export const outageFetch = (mode: 'reject' | '503' | 'hang'): typeof fetch =>
  (async (input: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    requests.push({ url: String(input), authorization: headers.get('authorization') ?? undefined })
    if (mode === 'hang') return new Promise<Response>(() => {})
    if (mode === '503') return new Response('cloud unavailable', { status: 503 })
    throw new Error('offline')
  }) as unknown as typeof fetch

// bindPorts swaps the credential sources before bindAccounts resolves them, so a spec never
// touches the developer's keychain or Codex file while importing accounts.
export const silentHostSources = (args: {
  container: DependencyContainer
  codexFile: string
}): void => {
  args.container.register(KeychainReaderToken, {
    useValue: {
      readGenericPassword: async () => {
        throw new Error('the keychain is not part of a local-first session')
      },
      writeGenericPassword: async () => {},
    } satisfies KeychainReader,
  })
  args.container.register(ClaudeCodeSourceToken, {
    useValue: new ClaudeCodeSource({ read: async () => undefined, write: async () => {} }),
  })
  args.container.register(CodexSourceToken, {
    useValue: new CodexSource({ file: join(args.codexFile) }),
  })
}

export class ScriptedLocalModel extends ModelPort {
  readonly identity = { id: 'anthropic', modelId: 'scripted-local' }
  readonly prompts: Assembled[] = []
  private readonly script: readonly { text: string }[]
  private stepIndex = 0

  constructor(args: { script: readonly { text: string }[] }) {
    super()
    this.script = args.script
  }

  override traits(): { contextWindow: number } {
    return { contextWindow: 200_000 }
  }

  async step(args: {
    assembled: Assembled
    tools: readonly ToolDeclaration[]
    signal: AbortSignal
    onChunk?: (chunk: Chunk) => Chunk | null
  }): Promise<ModelStepResult> {
    this.prompts.push(args.assembled)
    const step = this.script[this.stepIndex]
    this.stepIndex += 1
    if (step === undefined) throw new Error('the scripted model ran out of lines')
    return {
      parts: [{ type: 'text', text: step.text }],
      toolCalls: [],
      finishReason: EFinishReason.Stop,
    }
  }
}

export const registerModel = (args: {
  container: DependencyContainer
  model: ModelPort
}): void => {
  args.container.register(portToken(ModelPort), { useValue: args.model })
}
