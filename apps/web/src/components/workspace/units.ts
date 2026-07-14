export type MeasurementSystem = "metric" | "imperial";

const IMPERIAL_REGIONS = new Set(["US", "LR", "MM"]); // United States, Liberia, Myanmar

/** No existing convention for this anywhere in the app — there's no direct
 * browser API for "does this user prefer metric or imperial," so this uses
 * the standard practical heuristic: check the user's locale region against
 * the small set of countries that don't use metric. Defaults to metric on
 * any error (unsupported Intl.Locale, unknown region, etc.). */
export function detectMeasurementSystem(): MeasurementSystem {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    return region && IMPERIAL_REGIONS.has(region) ? "imperial" : "metric";
  } catch {
    return "metric";
  }
}

export function inchesToDisplay(inches: number, system: MeasurementSystem): number {
  return system === "imperial" ? inches : inches * 2.54;
}

export function displayToInches(value: number, system: MeasurementSystem): number {
  return system === "imperial" ? value : value / 2.54;
}

export function pxToLength(px: number, dpi: number, system: MeasurementSystem): number {
  return inchesToDisplay(px / dpi, system);
}

export function formatLength(px: number, dpi: number, system: MeasurementSystem): string {
  const value = pxToLength(px, dpi, system);
  return `${value.toFixed(1)} ${system === "imperial" ? "in" : "cm"}`;
}
