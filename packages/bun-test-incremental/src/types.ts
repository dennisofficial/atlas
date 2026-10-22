export enum EMode {
  Run = 'run',
  Force = 'force',
  Plan = 'plan',
  Clear = 'clear',
}

export enum EPathSink {
  Files = 'files',
  Dirs = 'dirs',
  Trees = 'trees',
  Stats = 'stats',
  StatInfo = 'statInfo',
  LstatInfo = 'lstatInfo',
}

export interface PendingOp {
  path: string;
  sink: EPathSink;
}

interface Observed {
  paths: Record<EPathSink, Set<string>>;
  env: Set<string>;
}

const SINKS = Object.values(EPathSink);

const emptyObserved = (): Observed => ({
  paths: Object.fromEntries(SINKS.map((sink) => [sink, new Set<string>()])) as Record<
    EPathSink,
    Set<string>
  >,
  env: new Set(),
});

function mergeInto(params: { target: Observed; source: Observed }) {
  const { target, source } = params;
  for (const sink of SINKS) for (const path of source.paths[sink]) target.paths[sink].add(path);
  for (const name of source.env) target.env.add(name);
}

export class FileRecord {
  readonly paths = emptyObserved().paths;
  readonly env = new Set<string>();
  readonly pending = new Set<PendingOp>();
  readonly spawned: string[] = [];
  readonly loadedAt = Date.now();
  uncacheable: string | undefined;
  failure: string | undefined;
  opened = 0;
  settled = 0;
  evaluated = false;
  private loadPhase: Observed | undefined;

  constructor(
    readonly absolute: string,
    readonly imports: string[],
  ) {}

  markUncacheable(reason: string) {
    this.uncacheable ??= reason;
  }

  fail(reason: string) {
    this.failure ??= reason;
  }

  settlePending() {
    for (const { path, sink } of this.pending) this.paths[sink].add(path);
    this.pending.clear();
  }

  endLoadPhase() {
    if (this.loadPhase) return;
    const snapshot = emptyObserved();
    mergeInto({ target: snapshot, source: { paths: this.paths, env: this.env } });
    for (const { path, sink } of this.pending) snapshot.paths[sink].add(path);
    this.loadPhase = snapshot;
  }

  inheritLoadPhase(from: FileRecord) {
    mergeInto({
      target: { paths: this.paths, env: this.env },
      source: from.loadPhase ?? { paths: from.paths, env: from.env },
    });
  }
}
