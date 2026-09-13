import type { Friend } from './types';

export type PlanStrategy = 'balanced' | 'total' | 'fair';

/** Keep existing v1 plans and migrate their missing travel mode to transit. */
export function parseSavedPlan(
  raw: string | null,
): { friends: Friend[]; strategy: PlanStrategy } | undefined {
  try {
    const saved = JSON.parse(raw ?? 'null');
    if (
      !Array.isArray(saved?.friends) ||
      saved.friends.length < 2 ||
      saved.friends.length > 8 ||
      !saved.friends.every(
        (f: Friend) =>
          typeof f?.id === 'string' &&
          typeof f.name === 'string' &&
          f.name.length <= 20 &&
          typeof f.address === 'string' &&
          f.address.length <= 200 &&
          /^#[0-9a-f]{6}$/i.test(f.color) &&
          Number.isFinite(f.weight) &&
          f.weight >= 0.2 &&
          f.weight <= 2 &&
          Number.isFinite(f.location?.lng) &&
          Number.isFinite(f.location?.lat) &&
          f.location?.lng >= 113.7 &&
          f.location.lng <= 114.65 &&
          f.location.lat >= 22.38 &&
          f.location.lat <= 22.9,
      ) ||
      new Set(saved.friends.map((f: Friend) => f.id)).size !== saved.friends.length
    )
      return undefined;
    return {
      friends: saved.friends.map((f: Friend) => ({
        ...f,
        travelMode: f.travelMode === 'driving' ? 'driving' : 'transit',
      })),
      strategy: ['balanced', 'total', 'fair'].includes(saved.strategy)
        ? saved.strategy
        : 'balanced',
    };
  } catch {
    return undefined;
  }
}
