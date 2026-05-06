import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { adminRouter } from "./routes/admin";
import { authRouter } from "./routes/auth";
import { questionsRouter } from "./routes/questions";
import { reportsRouter } from "./routes/reports";
import { usersRouter } from "./routes/users";
import { votesRouter } from "./routes/votes";
import { errorHandler } from "./middleware/errorHandler";
import { generalRateLimiter } from "./middleware/rateLimiter";

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(helmet());
app.use(cors());
app.use(morgan("combined"));
app.use(express.json({ limit: "1mb" }));
app.use(generalRateLimiter);

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "shouldi-api" });
});

app.use("/v1/auth", authRouter);
app.use("/v1/questions", questionsRouter);
app.use("/v1/questions", votesRouter);
app.use("/v1/questions", reportsRouter);
app.use("/v1/users", usersRouter);
app.use("/v1/admin", adminRouter);

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Should I API listening on port ${port}`);
});
