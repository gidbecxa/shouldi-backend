/**
 * Seed: new questions with/without context, plus realistic takes for UI/UX testing.
 * Run: npx tsx --env-file=.env scripts/seed-contexts-takes.ts
 *
 * Creates 6 ghost "take" users, 8 new questions, votes, and takes.
 * Safe to re-run — all inserts use ON CONFLICT DO NOTHING.
 */

import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { questions, users, votes, takes } from "../src/db/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL not set — run with --env-file=.env");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});
const db = drizzle(pool);

// ─── Ghost users ─────────────────────────────────────────────────────────────

const SEED_AUTHOR_DEVICE_ID = "seed-device-ghost-0000"; // existing seed user

const TAKE_USERS = [
  { deviceId: "seed-take-user-01", displayName: "Alex M." },
  { deviceId: "seed-take-user-02", displayName: "Sam K." },
  { deviceId: "seed-take-user-03", displayName: "Jordan T." },
  { deviceId: "seed-take-user-04", displayName: "Riley C." },
  { deviceId: "seed-take-user-05", displayName: "Morgan B." },
  { deviceId: "seed-take-user-06", displayName: "Casey D." },
];

// ─── Seed questions ───────────────────────────────────────────────────────────

const now = Date.now();
const h = (hours: number) => new Date(now + hours * 60 * 60 * 1000);

const SEED_Q = [
  // ── With context + takes ──────────────────────────────────────────────────
  {
    key: "abroad",
    text: "Quit my job and move abroad — my lease is up next month anyway?",
    context:
      "Been fully remote for 3 years, saving ~$2k/month. No dependants. Was planning a year in Lisbon or Chiang Mai but keep talking myself out of it. Nothing is actually holding me here.",
    category: "Career",
    yesCount: 6102,
    noCount: 3471,
    expiresAt: h(44),
    language: "en",
    takes: [
      { userKey: "seed-take-user-01", vote: "yes" as const, content: "Did exactly this in 2022. Moved to Bali with no plan. Best decision of my life — I'm writing this from a beach café." },
      { userKey: "seed-take-user-02", vote: "no" as const, content: "Sounds romantic but you'll be broke and lonely within 3 months. FOMO disappears fast when you can't afford dinner." },
      { userKey: "seed-take-user-03", vote: "yes" as const, content: "The only regret people have is not doing it sooner. Leases and jobs come back. Your 30s don't." },
      { userKey: "seed-take-user-04", vote: "no" as const, content: "Did this. Came back 8 months later, gap on my CV cost me 2 job offers. Just take a long vacation first." },
    ],
  },
  {
    key: "roommate",
    text: "Tell my roommate their late-night cooking smell is genuinely unbearable?",
    context:
      "We signed a 12-month lease, 6 months in. They fry fish or curry at 10–11pm, 3+ nights a week. The whole flat reeks until morning. I haven't slept properly in weeks.",
    category: "Life",
    yesCount: 11204,
    noCount: 1892,
    expiresAt: h(20),
    language: "en",
    takes: [
      { userKey: "seed-take-user-01", vote: "yes" as const, content: "Say something or you'll silently resent them for the next 6 months. Awkward 5-min convo > 6 months of misery." },
      { userKey: "seed-take-user-05", vote: "yes" as const, content: "Bring it up as a mutual problem, not an attack — 'hey the ventilation here is rough, could you open a window?' Works every time." },
      { userKey: "seed-take-user-06", vote: "no" as const, content: "I brought up something similar and my roommate made my life hell for weeks. Some things aren't worth the peace." },
    ],
  },
  {
    key: "bestman",
    text: "Decline the best man role because I genuinely can't afford it?",
    context:
      "My best friend asked me. The bachelor trip to Vegas is $2,200 minimum — flights, hotel, activities. I'm already carrying $8k in credit card debt and too embarrassed to say that out loud.",
    category: "Money",
    yesCount: 9831,
    noCount: 3102,
    expiresAt: h(36),
    language: "en",
    takes: [
      { userKey: "seed-take-user-04", vote: "yes" as const, content: "A real friend would rather have you there emotionally than stressed and broke. Tell him. He'll understand." },
      { userKey: "seed-take-user-02", vote: "yes" as const, content: "I was best man and confessed I was broke. He literally said 'I'll cover what I can.' Just have the conversation." },
      { userKey: "seed-take-user-03", vote: "no" as const, content: "This is once in a lifetime for him. Find the money — sell something, side gig for a month. You'll regret missing it." },
    ],
  },
  // ── With context, no takes ────────────────────────────────────────────────
  {
    key: "therapy",
    text: "Start therapy even though nothing is 'seriously wrong'?",
    context:
      "I'm functional, employed, loved. But I've been low-key anxious and kind of hollow for about 2 years and I can't figure out why. I keep dismissing it because I feel like I don't have a 'real reason' to go.",
    category: "Health",
    yesCount: 18204,
    noCount: 1102,
    expiresAt: h(55),
    language: "en",
    takes: [],
  },
  {
    key: "texting",
    text: "Send the first text after a first date that went really well?",
    context:
      "We talked for 4 hours, she laughed at everything, there was definitely a moment at the end. She said 'we should do this again' and then neither of us followed up. That was 3 days ago.",
    category: "Love",
    yesCount: 14102,
    noCount: 2301,
    expiresAt: h(15),
    language: "en",
    takes: [],
  },
  // ── Without context, with takes ───────────────────────────────────────────
  {
    key: "climate",
    text: "Would you date someone who doesn't believe in climate change?",
    context: null,
    category: "Love",
    yesCount: 4102,
    noCount: 12309,
    expiresAt: h(28),
    language: "en",
    takes: [
      { userKey: "seed-take-user-02", vote: "no" as const, content: "Values aren't just a preference. If someone denies basic science, where does it end? Hard dealbreaker for me." },
      { userKey: "seed-take-user-05", vote: "yes" as const, content: "My partner was skeptical when we met. 3 years later they sort recycling better than I do. People genuinely change." },
      { userKey: "seed-take-user-01", vote: "no" as const, content: "Dated someone like this. Every news story became an argument. I was constantly exhausted." },
    ],
  },
  {
    key: "tattoo",
    text: "Get a tattoo even though my parents are strongly against it?",
    context: null,
    category: "Life",
    yesCount: 13401,
    noCount: 4201,
    expiresAt: h(60),
    language: "en",
    takes: [
      { userKey: "seed-take-user-03", vote: "yes" as const, content: "Got mine at 25 despite family drama. Zero regrets 5 years later. You'll outlive their opinion." },
      { userKey: "seed-take-user-06", vote: "no" as const, content: "Make sure you actually want it for yourself, not just to prove a point. That's the only reason that matters." },
    ],
  },
  // ── Without context, no takes ─────────────────────────────────────────────
  {
    key: "grammar",
    text: "Is it rude to correct someone's grammar mid-conversation?",
    context: null,
    category: "Other",
    yesCount: 9402,
    noCount: 7801,
    expiresAt: h(32),
    language: "en",
    takes: [],
  },
];

// ─── Runner ──────────────────────────────────────────────────────────────────

async function seed() {
  console.log("▶ Seeding context + takes test data…\n");

  // 1. Get the seed author user
  const [authorRow] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.deviceId, SEED_AUTHOR_DEVICE_ID))
    .limit(1);

  if (!authorRow) {
    throw new Error("Seed author user not found — run the main seed.ts first.");
  }
  const authorId = authorRow.id;
  console.log(`✓ Seed author id: ${authorId}`);

  // 2. Upsert take ghost users
  const takeUserMap: Record<string, string> = {}; // deviceId → uuid

  for (const u of TAKE_USERS) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.deviceId, u.deviceId))
      .limit(1);

    if (existing.length > 0 && existing[0]) {
      takeUserMap[u.deviceId] = existing[0].id;
    } else {
      const [inserted] = await db
        .insert(users)
        .values({ deviceId: u.deviceId, displayName: u.displayName })
        .returning({ id: users.id });
      if (!inserted) throw new Error(`Failed to insert take user ${u.deviceId}`);
      takeUserMap[u.deviceId] = inserted.id;
    }
  }
  console.log(`✓ ${TAKE_USERS.length} take ghost users ready\n`);

  // 3. Upsert questions
  const existingTexts = new Set(
    (
      await db
        .select({ text: questions.text })
        .from(questions)
        .where(inArray(questions.text, SEED_Q.map((q) => q.text)))
    ).map((r) => r.text),
  );

  const questionIdMap: Record<string, string> = {}; // key → uuid

  for (const q of SEED_Q) {
    if (existingTexts.has(q.text)) {
      // Fetch existing id
      const [row] = await db
        .select({ id: questions.id })
        .from(questions)
        .where(eq(questions.text, q.text))
        .limit(1);
      if (row) {
        questionIdMap[q.key] = row.id;
        console.log(`  ~ [skip] "${q.text.slice(0, 60)}…" (already exists)`);
      }
    } else {
      const [row] = await db
        .insert(questions)
        .values({
          userId: authorId,
          text: q.text,
          context: q.context ?? null,
          category: q.category,
          language: q.language,
          yesCount: q.yesCount,
          noCount: q.noCount,
          expiresAt: q.expiresAt,
        })
        .returning({ id: questions.id });
      if (!row) throw new Error(`Failed to insert question: ${q.text}`);
      questionIdMap[q.key] = row.id;
      const tag = q.context ? "[+ctx]" : "[  -  ]";
      const takesTag = q.takes.length ? `[${q.takes.length} takes]` : "[no takes]";
      console.log(`  ✓ ${tag} ${takesTag} "${q.text.slice(0, 60)}…"`);
    }
  }

  // 4. Insert votes + takes
  console.log("\n▶ Inserting votes and takes…");
  let votesInserted = 0;
  let takesInserted = 0;

  for (const q of SEED_Q) {
    if (!q.takes.length) continue;
    const questionId = questionIdMap[q.key];
    if (!questionId) continue;

    for (const t of q.takes) {
      const userId = takeUserMap[t.userKey];
      if (!userId) continue;

      // Vote (ignore conflict — already voted)
      await db
        .insert(votes)
        .values({ questionId, userId, vote: t.vote })
        .onConflictDoNothing();
      votesInserted++;

      // Take (ignore conflict — already has one)
      await db
        .insert(takes)
        .values({ questionId, userId, vote: t.vote, content: t.content })
        .onConflictDoNothing();
      takesInserted++;
    }
  }

  // 5. Sync takes_count from actual takes rows (in case of re-runs)
  await pool.query(`
    UPDATE questions q
    SET takes_count = (
      SELECT COUNT(*) FROM takes t
      WHERE t.question_id = q.id AND t.status = 'active'
    )
    WHERE q.id = ANY($1::uuid[])
  `, [Object.values(questionIdMap)]);

  console.log(`✓ ${votesInserted} votes, ${takesInserted} takes inserted (conflicts skipped)\n`);
  console.log("✅ Done.\n");

  await pool.end();
}

seed().catch(async (err) => {
  console.error("❌ Seed failed:", err);
  await pool.end();
  process.exit(1);
});
