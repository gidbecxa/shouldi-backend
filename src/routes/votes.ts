import { Router } from "express";
import { z } from "zod";

import { deviceAuth } from "../middleware/deviceAuth";

export const votesRouter = Router();

const voteSchema = z.object({
  vote: z.enum(["yes", "no"]),
});

votesRouter.post("/:id/vote", deviceAuth, (req, res) => {
  const parsed = voteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  res.status(200).json({
    yes_count: 0,
    no_count: 0,
    yes_percent: 0,
    user_vote: parsed.data.vote,
  });
});
