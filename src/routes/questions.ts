import { Router } from "express";
import { z } from "zod";

import { deviceAuth } from "../middleware/deviceAuth";
import { questionPostRateLimiter } from "../middleware/rateLimiter";
import { evaluateQuestionContent } from "../services/contentFilter";

export const questionsRouter = Router();

const createQuestionSchema = z.object({
  text: z.string().trim().min(1).max(120),
  category: z.enum(["Life", "Love", "Career", "Money", "Health", "Fun", "Other"]),
  duration_hours: z.union([z.literal(1), z.literal(6), z.literal(24), z.literal(72)]),
});

questionsRouter.get("/", (_req, res) => {
  res.status(200).json({ questions: [], next_cursor: null });
});

questionsRouter.get("/:id", (req, res) => {
  res.status(200).json({ id: req.params.id, pending: true });
});

questionsRouter.post("/", deviceAuth, questionPostRateLimiter, async (req, res) => {
  const parsed = createQuestionSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const filterResult = await evaluateQuestionContent(parsed.data.text);
  if (filterResult.status === "blocked") {
    res.status(400).json({ error: "content_violation", message: "This question can't be posted." });
    return;
  }

  if (filterResult.status === "wellbeing_redirect") {
    res.status(400).json({
      error: "wellbeing_redirect",
      message: "It sounds like you might be going through something hard. You're not alone.",
      crisis_resources: filterResult.resources,
    });
    return;
  }

  res.status(201).json({
    question: {
      id: "pending-question-id",
      ...parsed.data,
    },
  });
});
