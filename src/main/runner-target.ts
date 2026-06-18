export interface RunnerConfig {
  remoteUrl: string
  localFallback: string
}

export interface RunnerTarget {
  type: 'remote' | 'local'
  target: string
}

export function resolveRunnerTarget(opts: {
  online: boolean
  config: RunnerConfig
}): RunnerTarget {
  const { online, config } = opts
  if (online && config.remoteUrl) {
    return { type: 'remote', target: config.remoteUrl }
  }
  return { type: 'local', target: config.localFallback }
}
