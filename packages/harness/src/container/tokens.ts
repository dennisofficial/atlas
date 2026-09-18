import type { LanguageModelV4 } from '@ai-sdk/provider'

import type {
  AccountStorePort,
  ClassifierPolicy,
  EWebSearchBackend,
  SecretsPort,
  SettingsStorePort,
} from '@dltech/atlas-core'

import type { PrismaClient } from '../../prisma/generated/client'
import type { DeltaChannel } from '../channel/delta-channel'
import type { CloudSessionStore } from '../cloud/cloud-session'
import type { ClaudeCodeSource } from '../credentials/claude-code-source'
import type { KeychainReader } from '../credentials/keychain-reader'
import type { DockerEngine } from '../execution/docker/engine'
import type { FileSecretsStore } from '../secrets/file-secrets-store'
import type { OnHookMishap } from '../hooks/budget'
import type { HookChain, HookChainSource } from '../hooks/registry'
import type { ModelCardSource } from '../model/ai-sdk-model-port'
import type { InjectionToken } from './injection'

export const PrismaClientToken: InjectionToken<PrismaClient> = Symbol('atlas.PrismaClient')

export const DeltaChannelToken: InjectionToken<DeltaChannel> = Symbol('atlas.DeltaChannel')

export const WorkspaceRoot: InjectionToken<string> = Symbol('atlas.WorkspaceRoot')

export const KeychainReaderToken: InjectionToken<KeychainReader> = Symbol('atlas.KeychainReader')

export const ClaudeCodeSourceToken: InjectionToken<ClaudeCodeSource> =
  Symbol('atlas.ClaudeCodeSource')

export const LanguageModelToken: InjectionToken<LanguageModelV4> = Symbol('atlas.LanguageModel')

export const ModelCardSourceToken: InjectionToken<ModelCardSource> =
  Symbol('atlas.ModelCardSource')

export const HookChainToken: InjectionToken<HookChain> = Symbol('atlas.HookChain')

export const HookChainSourceToken: InjectionToken<HookChainSource> =
  Symbol('atlas.HookChainSource')

export const HookMishapReporterToken: InjectionToken<OnHookMishap> =
  Symbol('atlas.HookMishapReporter')

export const UserSettingsStoreToken: InjectionToken<SettingsStorePort> = Symbol(
  'atlas.UserSettingsStore',
)

export const ProjectSettingsStoreToken: InjectionToken<SettingsStorePort> = Symbol(
  'atlas.ProjectSettingsStore',
)

export const WorktreeDirectoryToken: InjectionToken<() => string> = Symbol(
  'atlas.WorktreeDirectory',
)

export const WebSearchBackendToken: InjectionToken<() => EWebSearchBackend> = Symbol(
  'atlas.WebSearchBackend',
)

export const SecretsStoreToken: InjectionToken<SecretsPort> = Symbol('atlas.SecretsStore')

export const LocalSecretsStoreToken: InjectionToken<FileSecretsStore> = Symbol(
  'atlas.LocalSecretsStore',
)

export const CloudSessionStoreToken: InjectionToken<CloudSessionStore> = Symbol(
  'atlas.CloudSessionStore',
)

export const ClientVersionToken: InjectionToken<string> = Symbol('atlas.ClientVersion')

export const CloudRequiredToken: InjectionToken<() => boolean> = Symbol('atlas.CloudRequired')

export const LocalAccountStoreToken: InjectionToken<AccountStorePort> = Symbol(
  'atlas.LocalAccountStore',
)

export const DockerEngineToken: InjectionToken<DockerEngine> = Symbol('atlas.DockerEngine')

export const ClassifierPolicyToken: InjectionToken<() => ClassifierPolicy> = Symbol(
  'atlas.ClassifierPolicy',
)
