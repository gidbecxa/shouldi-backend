import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../common/database/database.service";
import { bannedKeywords } from "../db/schema";

export type FilterResult =
  | { status: "ok" }
  | { status: "blocked" }
  | { status: "wellbeing_redirect"; resources: string[] };

@Injectable()
export class ContentFilterService {
  private cache: { keywords: string[]; loadedAt: number } = { keywords: [], loadedAt: 0 };

  constructor(private readonly databaseService: DatabaseService) {}

  private readonly blockedPatterns: RegExp[] = [
    /kill\s+someone/i,
    /attack\s+them/i,
    /send\s+me\s+money/i,
    /phone\s+number/i,
  ];

  private readonly wellbeingPatterns: RegExp[] = [
    /kill\s+myself/i,
    /end\s+it\s+all/i,
    /hurt\s+myself/i,
    /take\s+my\s+life/i,
  ];

  async evaluate(questionText: string): Promise<FilterResult> {
    const normalizedText = questionText.toLowerCase();

    if (this.wellbeingPatterns.some((pattern) => pattern.test(questionText))) {
      return {
        status: "wellbeing_redirect",
        resources: ["US 988 Suicide & Crisis Lifeline", "https://findahelpline.com"],
      };
    }

    const keywords = await this.getBannedKeywords();
    if (keywords.some((keyword) => normalizedText.includes(keyword))) {
      return { status: "blocked" };
    }

    if (this.blockedPatterns.some((pattern) => pattern.test(questionText))) {
      return { status: "blocked" };
    }

    return { status: "ok" };
  }

  private async getBannedKeywords() {
    const now = Date.now();
    const cacheWindowMs = 5 * 60 * 1000;

    if (now - this.cache.loadedAt < cacheWindowMs && this.cache.keywords.length > 0) {
      return this.cache.keywords;
    }

    const rows = await this.databaseService.db
      .select({ keyword: bannedKeywords.keyword })
      .from(bannedKeywords);

    const keywords = rows
      .map((row) => row.keyword)
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.toLowerCase());

    this.cache = { keywords, loadedAt: now };
    return keywords;
  }
}

