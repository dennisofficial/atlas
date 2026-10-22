import * as bunTest from 'bun:test';
import { mock } from 'bun:test';
import type { FileRecord } from './types';

type Callable = (...args: unknown[]) => unknown;

export interface WrapContext {
  current: () => FileRecord | undefined;
}

type RowArities = ReadonlySet<number> | 'unknown';

interface ProxyHooks {
  args: (params: { args: unknown[]; rows: RowArities | undefined }) => unknown[];
  access: (key: string) => void;
}

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof value.then === 'function'
  );
}

// Bun appends a `done` callback only when the body declares more parameters than the
// `.each` row supplies, so a function as the last argument is `done` only if the row arity says so.
function hasDoneCallback(params: {
  body: Callable;
  args: unknown[];
  rows: RowArities | undefined;
}) {
  const { body, args, rows } = params;
  if (body.length === 0 || typeof args[args.length - 1] !== 'function') return false;
  if (rows === undefined) return true;
  if (rows === 'unknown') return false;
  return rows.has(args.length - 1) && !rows.has(args.length);
}

function rowArities(table: unknown): RowArities {
  if (!Array.isArray(table) || 'raw' in table) return 'unknown';
  return new Set(table.map((row: unknown) => (Array.isArray(row) ? row.length : 1)));
}

function instrument(params: {
  context: WrapContext;
  body: Callable;
  rows: RowArities | undefined;
}): Callable {
  const { context, body, rows } = params;
  const wrapper = function (this: unknown, ...args: unknown[]) {
    const record = context.current();
    if (!record) return body.apply(this, args);
    record.endLoadPhase();
    record.opened++;
    const settle = (failure?: string) => {
      record.settled++;
      if (failure !== undefined) record.fail(failure);
    };
    const last = args.length - 1;
    const done = args[last];
    if (typeof done === 'function' && hasDoneCallback({ body, args, rows })) {
      args[last] = (error?: unknown) => {
        settle(error ? describeError(error) : undefined);
        return done(error);
      };
      try {
        return body.apply(this, args);
      } catch (error) {
        settle(describeError(error));
        throw error;
      }
    }
    let result: unknown;
    try {
      result = body.apply(this, args);
    } catch (error) {
      settle(describeError(error));
      throw error;
    }
    if (!isThenable(result)) {
      settle();
      return result;
    }
    return result.then(
      (value) => {
        settle();
        return value;
      },
      (error: unknown) => {
        settle(describeError(error));
        throw error;
      },
    );
  };
  Object.defineProperty(wrapper, 'length', { value: body.length });
  return wrapper;
}

function deep(params: {
  target: Callable;
  hooks: ProxyHooks;
  owner?: object | undefined;
  key?: string | undefined;
  rows?: RowArities | undefined;
}): Callable {
  const { target, hooks, owner, key, rows } = params;
  return new Proxy(target, {
    get(inner, name) {
      const value: unknown = Reflect.get(inner, name);
      if (typeof name === 'string') hooks.access(name);
      if (typeof value !== 'function') return value;
      return deep({
        target: value as Callable,
        hooks,
        owner: inner,
        key: typeof name === 'string' ? name : undefined,
      });
    },
    apply(inner, self, args) {
      const result = Reflect.apply(inner, owner ?? self, hooks.args({ args, rows }));
      if (typeof result !== 'function') return result;
      const next = key === 'each' ? rowArities(args[0]) : undefined;
      return deep({ target: result as Callable, hooks, rows: next });
    },
  });
}

function watched(params: {
  target: Callable;
  access: (key: string) => void;
  owner?: object | undefined;
}): Callable {
  const { target, access, owner } = params;
  return new Proxy(target, {
    get(inner, name) {
      const value: unknown = Reflect.get(inner, name);
      if (typeof name === 'string') access(name);
      if (typeof value !== 'function') return value;
      return watched({ target: value as Callable, access, owner: inner });
    },
    apply(inner, self, args) {
      const result = Reflect.apply(inner, owner ?? self, args);
      return typeof result === 'function' ? watched({ target: result as Callable, access }) : result;
    },
  });
}

function replaceFirstFunction(params: { args: unknown[]; replace: (fn: Callable) => Callable }) {
  const { args, replace } = params;
  const index = args.findIndex((arg) => typeof arg === 'function');
  if (index < 0) return args;
  return args.map((arg, position) => (position === index ? replace(arg as Callable) : arg));
}

export function installBunTestWrap(context: WrapContext) {
  const real: Record<string, unknown> = { ...bunTest };
  const flagged = (keys: string[], reason: string) => (key: string) => {
    if (keys.includes(key)) context.current()?.markUncacheable(reason);
  };
  const idle = () => undefined;
  const wrapFor = (name: string, access: (key: string) => void) =>
    deep({
      target: real[name] as Callable,
      hooks: {
        access,
        args: ({ args, rows }) =>
          replaceFirstFunction({ args, replace: (body) => instrument({ context, body, rows }) }),
      },
    });
  const onlyFlag = flagged(['only'], 'uses .only');
  const overrides: Record<string, unknown> = {};
  for (const name of ['test', 'it']) overrides[name] = wrapFor(name, onlyFlag);
  for (const name of ['beforeAll', 'beforeEach', 'afterEach', 'afterAll']) {
    overrides[name] = wrapFor(name, idle);
  }
  overrides.describe = watched({ target: real.describe as Callable, access: onlyFlag });
  overrides.expect = watched({
    target: real.expect as Callable,
    access: flagged(['assertions', 'hasAssertions'], 'uses expect.assertions'),
  });
  mock.module('bun:test', () => ({ ...real, ...overrides }));
}

export function installTimerGuards(context: WrapContext) {
  const scope = globalThis as unknown as Record<string, Callable>;
  for (const name of ['setTimeout', 'setInterval', 'setImmediate']) {
    const original = scope[name];
    if (!original) continue;
    const guarded = function (this: unknown, ...args: unknown[]) {
      const record = context.current();
      const [callback, ...rest] = args;
      if (!record || typeof callback !== 'function') return original.apply(this, args);
      const guard = (...inner: unknown[]) => {
        try {
          return callback(...inner);
        } catch (error) {
          record.fail(`uncaught error in a ${name} callback: ${describeError(error)}`);
          throw error;
        }
      };
      return original.call(this, guard, ...rest);
    };
    for (const symbol of Object.getOwnPropertySymbols(original)) {
      Object.defineProperty(
        guarded,
        symbol,
        Object.getOwnPropertyDescriptor(original, symbol) ?? {},
      );
    }
    scope[name] = guarded;
  }
}
