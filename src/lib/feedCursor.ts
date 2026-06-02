/**
 * Compound feed cursor — encodes pagination state across priority tiers.
 *
 * A plain created_at cursor cannot express "I've consumed all of tier 1 and
 * am now partway through tier 2." The compound cursor carries the current tier
 * and the sort-position within that tier, enabling the SQL function to resume
 * correctly from any position.
 */

export interface FeedCursor {
  /** Priority tier of the last returned item (1–4) */
  tier: 1 | 2 | 3 | 4;
  /**
   * Sort position of the last item:
   * - Recent sort: ISO 8601 timestamp string
   * - Hot sort:    stringified float (trending score)
   */
  sortValue: string;
  /** UUID of the last item — deterministic tiebreaker when sortValue ties */
  id: string;
  /**
   * ISO timestamp of when the client first loaded this feed session.
   * All subsequent pages use this anchor to exclude questions posted after
   * session start, preventing page-shift on new inserts during browsing.
   */
  fetchedAt: string;
}

export function encodeCursor(cursor: FeedCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(encoded: string): FeedCursor | null {
  try {
    const json = Buffer.from(encoded, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (
      typeof parsed.tier === "number" &&
      typeof parsed.sortValue === "string" &&
      typeof parsed.id === "string" &&
      typeof parsed.fetchedAt === "string"
    ) {
      return parsed as unknown as FeedCursor;
    }
    return null;
  } catch {
    return null;
  }
}

export function buildCursorFromItem(
  item: { id: string; priority_tier: number; created_at: string; trending_score: number },
  sort: "recent" | "hot",
  fetchedAt: string,
): FeedCursor {
  return {
    tier: item.priority_tier as 1 | 2 | 3 | 4,
    sortValue: sort === "hot" ? String(item.trending_score) : item.created_at,
    id: item.id,
    fetchedAt,
  };
}
