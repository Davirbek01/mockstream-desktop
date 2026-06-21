export interface RunnerConfig {
  /** Explicit dev override (MOCKSTREAM_RUNNER_URL) or default placeholder URL. */
  remoteUrl: string
  /** Absolute path to the offline fallback HTML (renderer). */
  localFallback: string
  /** Absolute path to the bundled runner dist dir (packaged builds only). */
  bundledDir?: string
  /** Whether MOCKSTREAM_RUNNER_URL was explicitly set (forces remote). */
  explicitRemote?: boolean
  /** Whether the app is running packaged (app.isPackaged). */
  packaged?: boolean
}

export interface RunnerTarget {
  // remote  → loadURL(target) with did-fail-load → fallback safety
  // bundled → start local runner server on `target` (a dir), then loadURL
  // local   → loadFile(target) (fallback.html)
  type: 'remote' | 'bundled' | 'local'
  target: string
}

export function resolveRunnerTarget(opts: {
  online: boolean
  config: RunnerConfig
}): RunnerTarget {
  const { online, config } = opts

  // 1. Explicit env override always wins (dev convenience).
  if (config.explicitRemote && config.remoteUrl) {
    return { type: 'remote', target: config.remoteUrl }
  }

  // 2. Packaged app with a bundled runner dir → serve it locally.
  if (config.packaged && config.bundledDir) {
    return { type: 'bundled', target: config.bundledDir }
  }

  // 3. Legacy / dev behaviour: remote when online & configured, else fallback.
  if (online && config.remoteUrl) {
    return { type: 'remote', target: config.remoteUrl }
  }
  return { type: 'local', target: config.localFallback }
}
