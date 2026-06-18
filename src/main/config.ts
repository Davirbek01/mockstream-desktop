import { join } from 'node:path'
import type { RunnerConfig } from './runner-target'

// Default points at the deployed trimmed exam-runner. Override per build with
// MOCKSTREAM_RUNNER_URL. (Set this to the real runner URL from the web project.)
const DEFAULT_RUNNER_URL = 'https://exam.mockstream.app/runner'

export function loadRunnerConfig(): RunnerConfig {
  return {
    remoteUrl: process.env.MOCKSTREAM_RUNNER_URL ?? DEFAULT_RUNNER_URL,
    localFallback: join(__dirname, '../renderer/fallback.html')
  }
}
