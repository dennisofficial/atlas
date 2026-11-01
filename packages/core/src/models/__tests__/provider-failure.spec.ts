import { describe, expect, it } from 'bun:test'

import {
  EProviderFailureKind,
  EProviderFailureScope,
  EProviderRetry,
  type ProviderFailureEvidence,
} from '../provider-failure'

import { classify } from './provider-failure-fixture'

const { Credential, Route, Request } = EProviderFailureScope
const { Never, Transient } = EProviderRetry
const Kind = EProviderFailureKind

describe('classifying provider failures: the table', () => {
  it.each([
    ['missing key', { delivery: true }, Kind.Delivery, Request, Never],
    [
      'provider says missing auth header',
      {
        statusCode: 401,
        providerCode: 'invalid_api_key',
        providerMessage: 'Missing Authentication header',
      },
      Kind.Delivery,
      Request,
      Never,
    ],
    [
      'no authorization header',
      { statusCode: 401, providerMessage: 'No Authorization header provided' },
      Kind.Delivery,
      Request,
      Never,
    ],
    ['caller abort', { cancelled: true, statusCode: 429 }, Kind.Cancelled, Request, Never],
    [
      'insufficient_quota',
      { statusCode: 429, providerCode: 'insufficient_quota', authorizationDelivered: true },
      Kind.Quota,
      Credential,
      Never,
    ],
    [
      'billing_hard_limit_reached',
      { statusCode: 400, providerCode: 'billing_hard_limit_reached', authorizationDelivered: true },
      Kind.Quota,
      Credential,
      Never,
    ],
    [
      'payment_required',
      { providerType: 'payment_required', authorizationDelivered: true },
      Kind.Quota,
      Credential,
      Never,
    ],
    [
      '402 with delivered credential',
      { statusCode: 402, authorizationDelivered: true },
      Kind.Quota,
      Credential,
      Never,
    ],
    [
      'invalid_api_key',
      { statusCode: 401, providerCode: 'invalid_api_key', authorizationDelivered: true },
      Kind.Auth,
      Credential,
      Never,
    ],
    [
      'authentication_error',
      { statusCode: 401, providerType: 'authentication_error', authorizationDelivered: true },
      Kind.Auth,
      Credential,
      Never,
    ],
    [
      'invalid_authentication',
      { providerCode: 'invalid_authentication', authorizationDelivered: true },
      Kind.Auth,
      Credential,
      Never,
    ],
    [
      'bare 401 with delivered credential',
      { statusCode: 401, authorizationDelivered: true },
      Kind.Auth,
      Credential,
      Never,
    ],
    [
      'permission_error',
      { statusCode: 403, providerType: 'permission_error' },
      Kind.ModelDenied,
      Route,
      Never,
    ],
    ['generic 403', { statusCode: 403 }, Kind.ModelDenied, Route, Never],
    ['model_not_found', { providerCode: 'model_not_found' }, Kind.ModelDenied, Route, Never],
    ['404', { statusCode: 404 }, Kind.ModelDenied, Route, Never],
    [
      'context_length_exceeded',
      { statusCode: 400, providerCode: 'context_length_exceeded' },
      Kind.ContextOverflow,
      Request,
      Never,
    ],
    ['413', { statusCode: 413 }, Kind.ContextOverflow, Request, Never],
    ['429 without hard evidence', { statusCode: 429 }, Kind.RateLimited, Route, Transient],
    ['529', { statusCode: 529 }, Kind.Overloaded, Route, Transient],
    ['503', { statusCode: 503 }, Kind.Overloaded, Route, Transient],
    ['overloaded_error', { providerType: 'overloaded_error' }, Kind.Overloaded, Route, Transient],
    [
      'exact upstream 400 profile',
      {
        statusCode: 400,
        providerMessage: 'The upstream provider returned an error while processing this request.',
      },
      Kind.Overloaded,
      Route,
      Transient,
    ],
    ['dropped connection', { transport: true }, Kind.Network, Route, Transient],
    ['stream stall', { stalled: true, transport: true }, Kind.Stalled, Route, Transient],
    ['plain 400', { statusCode: 400 }, Kind.InvalidRequest, Request, Never],
    ['422', { statusCode: 422 }, Kind.InvalidRequest, Request, Never],
    ['local exception', {}, Kind.Other, Request, Never],
  ] satisfies [
    string,
    Partial<ProviderFailureEvidence>,
    EProviderFailureKind,
    EProviderFailureScope,
    EProviderRetry,
  ][])('%s', (_name, evidence, kind, scope, retry) => {
    expect(classify(evidence)).toMatchObject({ kind, scope, retry })
  })
})
