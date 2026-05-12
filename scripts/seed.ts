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
  language: string;
};

const SEED_QUESTIONS: SeedQuestion[] = [
  // ── EN: Career ──────────────────────────────────────────────────────────────
  { text: "Turn down the VP promotion and stay in the role I actually love — smart or stupid?", category: "Career", yesCount: 3241, noCount: 5187, expiresAt: h(19), language: "en" },
  { text: "Tell my manager their new process is slowing the whole team down?", category: "Career", yesCount: 8332, noCount: 2104, expiresAt: h(6), language: "en" },
  { text: "Drop out final semester to go all-in on a startup getting real traction?", category: "Career", yesCount: 5503, noCount: 6227, expiresAt: h(47), language: "en" },
  { text: "Accept a remote job in another country with no relocation support?", category: "Career", yesCount: 7112, noCount: 3891, expiresAt: h(28), language: "en" },
  { text: "Is it okay to ask for a raise 6 months into a new job?", category: "Career", yesCount: 9201, noCount: 4432, expiresAt: h(14), language: "en" },

  // ── EN: Love ────────────────────────────────────────────────────────────────
  { text: "End a 4-year relationship because we've outgrown each other, even though nothing is technically wrong?", category: "Love", yesCount: 7814, noCount: 4102, expiresAt: h(22), language: "en" },
  { text: "Text my ex after 18 months of no contact just to see if there's still something there?", category: "Love", yesCount: 4412, noCount: 8891, expiresAt: h(3), language: "en" },
  { text: "Confess my feelings to my best friend even though it could ruin the friendship?", category: "Love", yesCount: 6019, noCount: 5740, expiresAt: h(71), language: "en" },
  { text: "Am I wrong for wanting separate vacations from my long-term partner sometimes?", category: "Love", yesCount: 8231, noCount: 3210, expiresAt: h(38), language: "en" },
  { text: "Would you stay with someone you love who has completely different life goals?", category: "Love", yesCount: 5512, noCount: 7812, expiresAt: h(9), language: "en" },

  // ── EN: Money ───────────────────────────────────────────────────────────────
  { text: "Drain emergency fund to put $5k into Bitcoin right now while the price is still recovering?", category: "Money", yesCount: 2118, noCount: 11344, expiresAt: h(11), language: "en" },
  { text: "Take a 30% pay cut to join a mission-driven nonprofit doing work I actually believe in?", category: "Money", yesCount: 7881, noCount: 5142, expiresAt: h(35), language: "en" },
  { text: "Is it reasonable to split every bill 50/50 even if one partner earns twice the other?", category: "Money", yesCount: 6102, noCount: 8234, expiresAt: h(18), language: "en" },
  { text: "Was I wrong to lend $2k to a friend who never paid me back — do I ask again?", category: "Money", yesCount: 10231, noCount: 4512, expiresAt: h(52), language: "en" },

  // ── EN: Life ────────────────────────────────────────────────────────────────
  { text: "Delete all social media apps for 3 months even though my side business depends on them?", category: "Life", yesCount: 9201, noCount: 3437, expiresAt: h(23), language: "en" },
  { text: "Move to a new city alone where I know nobody, just because I need a real change?", category: "Life", yesCount: 11542, noCount: 4318, expiresAt: h(58), language: "en" },
  { text: "Is it weird to prefer staying home over going to a party almost every time?", category: "Life", yesCount: 14321, noCount: 2102, expiresAt: h(40), language: "en" },
  { text: "Can I skip my coworker's wedding if I'm not that close to them?", category: "Life", yesCount: 8112, noCount: 5803, expiresAt: h(27), language: "en" },

  // ── EN: Health ──────────────────────────────────────────────────────────────
  { text: "Quit gym membership and commit to only working out at home for the next year?", category: "Health", yesCount: 6523, noCount: 4891, expiresAt: h(14), language: "en" },
  { text: "Cut alcohol completely — even at social events — for 6 months to see if it changes my anxiety?", category: "Health", yesCount: 13207, noCount: 1893, expiresAt: h(42), language: "en" },
  { text: "Is it okay to prioritize sleep over exercise when you're genuinely exhausted?", category: "Health", yesCount: 16201, noCount: 1432, expiresAt: h(32), language: "en" },

  // ── EN: Fun ─────────────────────────────────────────────────────────────────
  { text: "Book a last-minute solo trip to Japan next month and deal with the $1,200 bill later?", category: "Fun", yesCount: 12041, noCount: 3209, expiresAt: h(8), language: "en" },
  { text: "Quit my stable weekend job to focus all my free time on making my music go somewhere?", category: "Fun", yesCount: 9877, noCount: 4551, expiresAt: h(30), language: "en" },
  { text: "Would you adopt a rescue dog even if you live in a studio apartment?", category: "Fun", yesCount: 11232, noCount: 5001, expiresAt: h(63), language: "en" },

  // ── EN: Other ────────────────────────────────────────────────────────────────
  { text: "Confront my landlord about the mold issue even though my lease is up for renewal in 6 weeks?", category: "Other", yesCount: 14302, noCount: 891, expiresAt: h(17), language: "en" },
  { text: "Is it normal to not know what you want to do with your life at 28?", category: "Other", yesCount: 19012, noCount: 1203, expiresAt: h(45), language: "en" },
  { text: "Am I overreacting if I'm upset my friends didn't remember my birthday?", category: "Other", yesCount: 8231, noCount: 6102, expiresAt: h(20), language: "en" },
  { text: "Block someone on all platforms if they keep texting after you asked them not to?", category: "Other", yesCount: 17201, noCount: 2103, expiresAt: h(13), language: "en" },
  { text: "Was it rude to leave a dinner early without telling the host beforehand?", category: "Other", yesCount: 7102, noCount: 9312, expiresAt: h(36), language: "en" },
  { text: "Is it okay to not want kids and never change your mind?", category: "Other", yesCount: 22031, noCount: 3102, expiresAt: h(55), language: "en" },

  // ── FR: Carrière ─────────────────────────────────────────────────────────────
  { text: "Refuser une promotion pour garder un poste qui me rend heureux — sage ou naïf ?", category: "Career", yesCount: 3112, noCount: 4801, expiresAt: h(21), language: "fr" },
  { text: "Dire à mon manager que sa nouvelle méthode ralentit toute l'équipe ?", category: "Career", yesCount: 7201, noCount: 2301, expiresAt: h(7), language: "fr" },
  { text: "Quitter mon master en dernière année pour tout miser sur une startup qui décolle ?", category: "Career", yesCount: 4901, noCount: 5812, expiresAt: h(49), language: "fr" },
  { text: "Est-ce normal de s'ennuyer dans un job bien payé et confortable ?", category: "Career", yesCount: 9102, noCount: 4201, expiresAt: h(16), language: "fr" },

  // ── FR: Amour ────────────────────────────────────────────────────────────────
  { text: "Mettre fin à 4 ans de relation parce qu'on n'évolue plus ensemble ?", category: "Love", yesCount: 6312, noCount: 4001, expiresAt: h(24), language: "fr" },
  { text: "Envoyer un message à mon ex après 18 mois sans contact ?", category: "Love", yesCount: 3812, noCount: 8201, expiresAt: h(4), language: "fr" },
  { text: "Avouer mes sentiments à mon meilleur ami au risque de tout perdre ?", category: "Love", yesCount: 5401, noCount: 5201, expiresAt: h(72), language: "fr" },
  { text: "Est-ce acceptable de vouloir des vacances séparées de son partenaire ?", category: "Love", yesCount: 7801, noCount: 3101, expiresAt: h(39), language: "fr" },

  // ── FR: Argent ───────────────────────────────────────────────────────────────
  { text: "Investir 5 000 € en crypto alors que c'est mes économies d'urgence ?", category: "Money", yesCount: 1901, noCount: 10201, expiresAt: h(12), language: "fr" },
  { text: "Accepter une baisse de salaire de 30% pour rejoindre une ONG qui me passionne ?", category: "Money", yesCount: 7101, noCount: 4801, expiresAt: h(37), language: "fr" },

  // ── FR: Vie ──────────────────────────────────────────────────────────────────
  { text: "Supprimer toutes mes applis réseaux sociaux pendant 3 mois ?", category: "Life", yesCount: 8401, noCount: 3201, expiresAt: h(25), language: "fr" },
  { text: "Déménager dans une nouvelle ville seul juste pour changer de vie ?", category: "Life", yesCount: 10201, noCount: 4101, expiresAt: h(60), language: "fr" },
  { text: "C'est bizarre de préférer rester chez soi plutôt que sortir en soirée ?", category: "Life", yesCount: 13201, noCount: 2001, expiresAt: h(41), language: "fr" },

  // ── FR: Santé ────────────────────────────────────────────────────────────────
  { text: "Arrêter totalement l'alcool pendant 6 mois pour voir l'effet sur mon anxiété ?", category: "Health", yesCount: 12101, noCount: 1801, expiresAt: h(43), language: "fr" },
  { text: "Est-ce ok de prioriser le sommeil sur le sport quand on est épuisé ?", category: "Health", yesCount: 15201, noCount: 1401, expiresAt: h(33), language: "fr" },

  // ── FR: Fun / Autre ───────────────────────────────────────────────────────────
  { text: "Réserver un voyage solo au Japon la semaine prochaine et assumer la facture plus tard ?", category: "Fun", yesCount: 11201, noCount: 3101, expiresAt: h(9), language: "fr" },
  { text: "C'est normal de ne pas savoir ce qu'on veut faire de sa vie à 28 ans ?", category: "Other", yesCount: 18201, noCount: 1101, expiresAt: h(46), language: "fr" },
  { text: "Bloquer quelqu'un sur tous les réseaux s'il continue à écrire après qu'on lui a demandé d'arrêter ?", category: "Other", yesCount: 16201, noCount: 2001, expiresAt: h(14), language: "fr" },
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
        language: q.language,
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
