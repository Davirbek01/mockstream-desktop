import { describe, it, expect } from 'vitest'
import { resolveRunnerTarget } from './runner-target'

const config = { remoteUrl: 'https://exam.example/runner', localFallback: '/abs/fallback.html' }

describe('resolveRunnerTarget', () => {
  it('loads the remote runner when online', () => {
    expect(resolveRunnerTarget({ online: true, config }))
      .toEqual({ type: 'remote', target: 'https://exam.example/runner' })
  })

  it('falls back to the local file when offline', () => {
    expect(resolveRunnerTarget({ online: false, config }))
      .toEqual({ type: 'local', target: '/abs/fallback.html' })
  })

  it('falls back to local when remoteUrl is empty even if online', () => {
    expect(resolveRunnerTarget({ online: true, config: { ...config, remoteUrl: '' } }))
      .toEqual({ type: 'local', target: '/abs/fallback.html' })
  })
})
