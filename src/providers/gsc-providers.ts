import type { GscProvider, GscRequest, GscResponse } from "@/providers/types";

// Google Search Console provider registry.
//
// The only supported GSC interface is the official Search Console API, which
// requires per-user OAuth2 consent plus Google Cloud project credentials. No
// such provider is configured in this deployment, so the default provider
// honestly reports that automated refresh is unavailable and points at the
// supported fallback (GSC CSV import, see searchconsole.service.ts).
//
// To add a real provider: implement GscProvider (authorized API only, honest
// nulls for missing metrics) and register() it. Never scrape Google Search
// Console; require explicit OAuth consent and a verifiable property.

class UnavailableGscProvider implements GscProvider {
  readonly id = "unavailable";
  readonly name = "No automated Search Console source";
  readonly capabilities =
    "Google Search Console data is only available through the official Search " +
    "Console API, which requires per-user OAuth2 consent and a Google Cloud " +
    "project. No such provider is configured/verified, so automated refreshes " +
    "report this limitation instead of fabricating metrics. Use GSC CSV import " +
    "as the supported manual fallback (Imports -> Search Console).";

  async fetch(_req: GscRequest): Promise<GscResponse> {
    return {
      ok: false,
      error:
        "No reliable automated Google Search Console provider is configured. " +
        "Automated refresh is unavailable; import Search Console data manually via CSV.",
    };
  }
}

const registry = new Map<string, GscProvider>();
register(new UnavailableGscProvider());

export function register(provider: GscProvider): void {
  registry.set(provider.id, provider);
}

export function getGscProvider(id?: string | null): GscProvider {
  return registry.get(id ?? "") ?? registry.get("unavailable")!;
}

export function listGscProviders(): GscProvider[] {
  return [...registry.values()];
}