import { join } from 'node:path'
import type { RunnerConfig } from './runner-target'

// Default points at the deployed trimmed exam-runner. Override per build with
// MOCKSTREAM_RUNNER_URL. (Set this to the real runner URL from the web project.)
const DEFAULT_RUNNER_URL = 'https://exam.mockstream.app/runner'

export interface LoadRunnerConfigOpts {
  /** app.isPackaged — when true and a bundled runner exists, serve it locally. */
  packaged?: boolean
  /** process.resourcesPath — where electron-builder unpacks extraResources. */
  resourcesPath?: string
}

export function loadRunnerConfig(opts: LoadRunnerConfigOpts = {}): RunnerConfig {
  const envUrl = process.env.MOCKSTREAM_RUNNER_URL
  const explicitRemote = typeof envUrl === 'string' && envUrl.length > 0

  // Packaged builds bundle the runner's dist under <resources>/runner via the
  // electron-builder `extraResources` mapping.
  const bundledDir =
    opts.packaged && opts.resourcesPath ? join(opts.resourcesPath, 'runner') : undefined

  return {
    remoteUrl: envUrl ?? DEFAULT_RUNNER_URL,
    localFallback: join(__dirname, '../renderer/fallback.html'),
    bundledDir,
    explicitRemote,
    packaged: opts.packaged
  }
}
