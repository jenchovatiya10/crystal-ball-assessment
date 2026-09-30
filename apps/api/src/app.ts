import cors from "cors";
import express, { type Express } from "express";

/**
 * Minimal Express app shell. Feature routes intentionally omitted.
 */
export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  return app;
}
