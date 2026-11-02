// ============================================================================
// Build-time flavor (white-label desktop), in ONE place.
//
// FLAVOR=bek builds the "Bekzods Multilevel" desktop app; unset / anything
// else = Mock Stream. The identity is baked into the main-process bundle via
// Vite `define`, so the packaged app carries its own name / protocol / appId
// with no runtime env needed. The bundled runner's CENTRE comes separately
// from VITE_CENTER_ID when the runner is built (see the dist:bek script).
//
// This lives outside electron.vite.config.ts because vitest needs the same
// defines: without them `src/main/notifications.ts` throws "__BRAND_NAME__ is
// not defined" the moment it is imported, and the whole test file fails to
// collect. Two copies of the table would drift apart the first time a centre
// was renamed, so both configs read this one.
// ============================================================================
export interface Brand {
  name: string
  protocol: string
  appId: string
}

export const BRANDS: Record<string, Brand> = {
  mock_stream: { name: 'Mock Stream', protocol: 'mockstream', appId: 'app.mockstream.desktop' },
  bek: { name: 'Bekzods Multilevel', protocol: 'mockstreambek', appId: 'app.mockstream.bek.desktop' },
  record: { name: 'Cambridge Innovation School', protocol: 'mockstreamrecord', appId: 'app.mockstream.record.desktop' },
  niners: { name: 'Niners Academy', protocol: 'mockstreamniners', appId: 'app.mockstream.niners.desktop' },
  global: { name: 'Global Education LC', protocol: 'mockstreamglobal', appId: 'app.mockstream.global.desktop' },
  achievers: { name: 'Achievers Academy', protocol: 'mockstreamachievers', appId: 'app.mockstream.achievers.desktop' },
  muzaffars: { name: "Muzaffar's English", protocol: 'mockstreammuzaffars', appId: 'app.mockstream.muzaffars.desktop' },
  max: { name: 'Multilevel Max', protocol: 'mockstreammax', appId: 'app.mockstream.max.desktop' },
}

/** The brand FLAVOR selects, falling back to Mock Stream. */
export function activeBrand(flavor = process.env.FLAVOR || 'mock_stream'): Brand {
  return BRANDS[flavor] || BRANDS.mock_stream
}

/** The `define` map both electron-vite and vitest pass to the transformer. */
export function brandDefine(flavor?: string): Record<string, string> {
  const brand = activeBrand(flavor)
  return {
    __BRAND_NAME__: JSON.stringify(brand.name),
    __BRAND_PROTOCOL__: JSON.stringify(brand.protocol),
    __BRAND_APP_ID__: JSON.stringify(brand.appId),
  }
}
