import type { TrendsProvider, TrendsRequest, TrendsResponse } from "@/providers/types";

// Default trends provider: honestly reports that no reliable automated Google
// Trends source is configured. It never fabricates daily measurements.
// Manual CSV import remains the supported fallback (see trends.service.ts).
class UnavailableTrendsProvider implements TrendsProvider {
  readonly id = "unavailable";
  readonly name = "No automated Trends source";
  readonly capabilities =
    "Google Trends has no stable, officially supported public API for all features. " +
    "No automated source is configured/verified, so automated checks report this limitation. " +
    "Use manual CSV import of Trends observations instead."

  async fetch(_req: TrendsRequest): Promise<TrendsResponse> {
    return {
      ok: false,
      error:
        "No reliable automated Google Trends provider is configured. " +
        "Automated monitoring is unavailable; import Trends observations manually via CSV.",
    };
  }
}

const registry = new Map<string, TrendsProvider>();
register(new UnavailableTrendsProvider());

export function register(provider: TrendsProvider): void {
  registry.set(provider.id, provider);
}

export function getTrendsProvider(id?: string | null): TrendsProvider {
  return registry.get(id ?? "") ?? registry.get("unavailable")!;
}

export function listTrendsProviders(): TrendsProvider[] {
  return [...registry.values()];
}
