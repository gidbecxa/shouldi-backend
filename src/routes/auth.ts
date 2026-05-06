import { Router } from "express";
import { z } from "zod";

export const authRouter = Router();

const sessionSchema = z.object({
  device_id: z.string().min(8),
});

authRouter.post("/session", (req, res) => {
  const parsed = sessionSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  res.status(200).json({
    user_id: "pending-user-id",
    is_banned: false,
  });
});
