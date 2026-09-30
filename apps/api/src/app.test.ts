import request from "supertest";
import { createApp } from "./app.js";

describe("createApp", () => {
  it("creates an Express app that responds to unknown routes with 404", async () => {
    const app = createApp();
    const response = await request(app).get("/__foundation_probe__");
    expect(response.status).toBe(404);
  });
});
