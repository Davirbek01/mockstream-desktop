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

  it('explicit env remote override wins even when packaged with a bundled dir', () => {
    expect(
      resolveRunnerTarget({
        online: true,
        config: { ...config, explicitRemote: true, packaged: true, bundledDir: '/res/runner' }
      })
    ).toEqual({ type: 'remote', target: 'https://exam.example/runner' })
  })

  it('serves the bundled runner dir when packaged and no env override', () => {
    expect(
      resolveRunnerTarget({
        online: true,
        config: { ...config, packaged: true, bundledDir: '/res/runner' }
      })
    ).toEqual({ type: 'bundled', target: '/res/runner' })
  })

  it('serves the bundled runner even when offline (data layer handles network)', () => {
    expect(
      resolveRunnerTarget({
        online: false,
        config: { ...config, packaged: true, bundledDir: '/res/runner' }
      })
    ).toEqual({ type: 'bundled', target: '/res/runner' })
  })

  it('packaged without a bundled dir falls back to legacy behaviour', () => {
    expect(
      resolveRunnerTarget({ online: false, config: { ...config, packaged: true } })
    ).toEqual({ type: 'local', target: '/abs/fallback.html' })
  })
})
