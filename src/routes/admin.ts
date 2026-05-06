import { Router } from "express";

export const adminRouter = Router();

adminRouter.use((req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  const adminSecret = process.env.ADMIN_SECRET;

  if (!token || !adminSecret || token !== adminSecret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
});

adminRouter.get("/flagged", (_req, res) => {
  res.status(200).json({ questions: [] });
});

adminRouter.patch("/questions/:id/status", (req, res) => {
  res.status(200).json({ id: req.params.id, updated: true });
});

adminRouter.post("/users/:id/ban", (req, res) => {
  res.status(200).json({ id: req.params.id, banned: true });
});
