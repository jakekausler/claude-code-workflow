/**
 * Parse a refinement_type value that may be stored as a JSON string
 * (e.g. '["frontend"]') or a plain string (e.g. 'frontend') into an array.
 */
export function parseRefinementType(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v): v is string => typeof v === 'string');
    }
    return typeof parsed === 'string' ? [parsed] : [];
  } catch {
    // Not JSON — treat as a plain string value
    return [raw];
  }
}
