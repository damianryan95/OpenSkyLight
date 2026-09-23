import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The native shell around the parent administration app (ADR 0005).
 *
 * `CapacitorHttp` is not an optimisation here, it is load-bearing. The webview
 * origin is `https://localhost`, so every request to the household server is
 * cross-origin, and the parent credential travels in an `Authorization` header
 * — which is never a CORS-simple header, so the webview would preflight. The
 * server answers no preflight and sends no `Access-Control-*` headers, by
 * design: adding them would hand back most of what the origin check buys the
 * browser at `/admin/`. Routing fetch through the native HTTP layer sidesteps
 * CORS entirely, which is the supported way to talk to a private LAN server.
 *
 * Turn this off and the app authenticates against nothing.
 */
const config: CapacitorConfig = {
  appId: 'uk.co.openskylight.companion',
  appName: 'OpenSkyLight',
  webDir: 'out/app',
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  },
  android: {
    // Lets the `https://localhost` webview load plain-HTTP subresources. This
    // is NOT what permits the app to call the household server: Android blocks
    // cleartext at the platform level from API 28, regardless of this setting,
    // and lifting that needs the network security config referenced from
    // `AndroidManifest.xml`. Conflating the two costs an afternoon — the app
    // builds, runs, and fails every request with a bare network error.
    allowMixedContent: true
  }
}

export default config
