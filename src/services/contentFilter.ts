type FilterResult =
  | { status: "ok" }
  | { status: "blocked" }
  | { status: "wellbeing_redirect"; resources: string[] };

const blockedPatterns: RegExp[] = [
  /kill\s+someone/i,
  /hate\s+speech/i,
  /send\s+me\s+money/i,
];

const wellbeingPatterns: RegExp[] = [
  /kill\s+myself/i,
  /end\s+it\s+all/i,
  /hurt\s+myself/i,
  /take\s+my\s+life/i,
];

export async function evaluateQuestionContent(text: string): Promise<FilterResult> {
  if (wellbeingPatterns.some((pattern) => pattern.test(text))) {
    return {
      status: "wellbeing_redirect",
      resources: ["US 988 Suicide & Crisis Lifeline", "https://findahelpline.com"],
    };
  }

  if (blockedPatterns.some((pattern) => pattern.test(text))) {
    return { status: "blocked" };
  }

  return { status: "ok" };
}
