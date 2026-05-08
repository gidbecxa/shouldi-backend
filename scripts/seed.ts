/**
 * Seed script — inserts a ghost user + realistic questions with synthetic vote counts.
 * Run: npx tsx --env-file=.env scripts/seed.ts
 *
 * Safe to run multiple times: uses ON CONFLICT DO NOTHING on the user,
 * and skips question texts that already exist.
 */

import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, inArray } from "drizzle-orm";
import { questions, users } from "../src/db/schema";

const SEED_DEVICE_ID = "seed-device-ghost-0000";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL not set — run with --env-file=.env");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});
const db = drizzle(pool);

// ─── Seed data ───────────────────────────────────────────────────────────────

const now = Date.now();
const h = (hours: number) => new Date(now + hours * 60 * 60 * 1000);

type SeedQuestion = {
  text: string;
  category: string;
  yesCount: number;
  noCount: number;
  expiresAt: Date;
};

const SEED_QUESTIONS: SeedQuestion[] = [
  // ── Career ──────────────────────────────────────────────────────────────────
  {
    text: "Should I turn down the VP promotion and stay in the role I actually love, even if it means no salary bump?",
    category: "Career",
    yesCount: 3_241,
    noCount: 5_187,
    expiresAt: h(19),
  },
  {
    text: "Should I tell my manager their new process is slowing the whole team down, even if it causes friction?",
    category: "Career",
    yesCount: 8_332,
    noCount: 2_104,
    expiresAt: h(6),
  },
  {
    text: "Should I drop out of my master's in the final semester to go all-in on a startup that's getting real traction?",
    category: "Career",
    yesCount: 5_503,
    noCount: 6_227,
    expiresAt: h(47),
  },

  // ── Love ────────────────────────────────────────────────────────────────────
  {
    text: "Should I end a 4-year relationship because we've outgrown each other, even though nothing is technically wrong?",
    category: "Love",
    yesCount: 7_814,
    noCount: 4_102,
    expiresAt: h(22),
  },
  {
    text: "Should I text my ex after 18 months of no contact just to see if there's still something there?",
    category: "Love",
    yesCount: 4_412,
    noCount: 8_891,
    expiresAt: h(3),
  },
  {
    text: "Should I confess my feelings to my best friend even though it could ruin one of the most important friendships I have?",
    category: "Love",
    yesCount: 6_019,
    noCount: 5_740,
    expiresAt: h(71),
  },

  // ── Money ───────────────────────────────────────────────────────────────────
  {
    text: "Should I drain my emergency fund to put $5k into Bitcoin right now while the price is still recovering?",
    category: "Money",
    yesCount: 2_118,
    noCount: 11_344,
    expiresAt: h(11),
  },
  {
    text: "Should I take a 30% pay cut to join a mission-driven nonprofit doing work I actually believe in?",
    category: "Money",
    yesCount: 7_881,
    noCount: 5_142,
    expiresAt: h(35),
  },

  // ── Life ────────────────────────────────────────────────────────────────────
  {
    text: "Should I delete all my social media apps for 3 months even though my side business depends on them?",
    category: "Life",
    yesCount: 9_201,
    noCount: 3_437,
    expiresAt: h(23),
  },
  {
    text: "Should I move to a new city alone where I know nobody, just because I need a real change in my life?",
    category: "Life",
    yesCount: 11_542,
    noCount: 4_318,
    expiresAt: h(58),
  },

  // ── Health ──────────────────────────────────────────────────────────────────
  {
    text: "Should I quit my gym membership and commit to only working out at home for the next year?",
    category: "Health",
    yesCount: 6_523,
    noCount: 4_891,
    expiresAt: h(14),
  },
  {
    text: "Should I cut alcohol completely — even at social events — for 6 months to see if it changes my anxiety?",
    category: "Health",
    yesCount: 13_207,
    noCount: 1_893,
    expiresAt: h(42),
  },

  // ── Fun ─────────────────────────────────────────────────────────────────────
  {
    text: "Should I book a last-minute solo trip to Japan next month and deal with the $1,200 bill later?",
    category: "Fun",
    yesCount: 12_041,
    noCount: 3_209,
    expiresAt: h(8),
  },
  {
    text: "Should I quit my stable weekend job to focus all my free time on making my music actually go somewhere?",
    category: "Fun",
    yesCount: 9_877,
    noCount: 4_551,
    expiresAt: h(30),
  },

  // ── Other ────────────────────────────────────────────────────────────────────
  {
    text: "Should I confront my landlord about the mold issue even though my lease is up for renewal in 6 weeks?",
    category: "Other",
    yesCount: 14_302,
    noCount: 891,
    expiresAt: h(17),
  },
];

// ─── Runner ──────────────────────────────────────────────────────────────────

async function seed() {
  console.log("▶ Seeding Should I? database…\n");

  // 1. Upsert the ghost seed user
  const existingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.deviceId, SEED_DEVICE_ID))
    .limit(1);

  let seedUserId: string;

  if (existingUsers.length > 0 && existingUsers[0]) {
    seedUserId = existingUsers[0].id;
    console.log(`✓ Seed user already exists — id: ${seedUserId}`);
  } else {
    const [inserted] = await db
      .insert(users)
      .values({
        deviceId: SEED_DEVICE_ID,
        displayName: "Should I? Team",
      })
      .returning({ id: users.id });

    if (!inserted) throw new Error("Failed to insert seed user");
    seedUserId = inserted.id;
    console.log(`✓ Created seed user — id: ${seedUserId}`);
  }

  // 2. Skip texts that already exist in the DB
  const existingTexts = new Set(
    (await db.select({ text: questions.text }).from(questions)
      .where(inArray(questions.text, SEED_QUESTIONS.map((q) => q.text))))
      .map((r) => r.text),
  );

  const toInsert = SEED_QUESTIONS.filter((q) => !existingTexts.has(q.text));

  if (toInsert.length === 0) {
    console.log("✓ All questions already seeded — nothing to insert.\n");
    await pool.end();
    return;
  }

  console.log(`\n▶ Inserting ${toInsert.length} question(s)…`);

  const inserted = await db
    .insert(questions)
    .values(
      toInsert.map((q) => ({
        userId: seedUserId,
        text: q.text,
        category: q.category,
        yesCount: q.yesCount,
        noCount: q.noCount,
        expiresAt: q.expiresAt,
      })),
    )
    .returning({ id: questions.id, text: questions.text });

  for (const row of inserted) {
    console.log(`  ✓ [${row.id.slice(0, 8)}] ${row.text.slice(0, 70)}…`);
  }

  console.log(`\n✅ Done — ${inserted.length} question(s) seeded.\n`);
  await pool.end();
}

seed().catch(async (err) => {
  console.error("❌ Seed failed:", err);
  await pool.end();
  process.exit(1);
});
