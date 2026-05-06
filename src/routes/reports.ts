import { Router } from "express";
import { z } from "zod";

import { deviceAuth } from "../middleware/deviceAuth";

export const reportsRouter = Router();

const reportSchema = z.object({
  reason: z.enum(["harmful", "inappropriate", "spam", "personal_attack"]),
});

reportsRouter.post("/:id/report", deviceAuth, (req, res) => {
  const parsed = reportSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  res.status(200).json({ reported: true });
});
