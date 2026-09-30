import { AnthropicProvider } from "./ai/AnthropicProvider.js";
import { createResilientAIProvider } from "./ai/resilience.js";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { APPROVALS } from "./fixtures/approvals.js";

const env = loadEnv();

const anthropic = new AnthropicProvider({
  apiKey: env.ANTHROPIC_API_KEY,
  model: env.ANTHROPIC_MODEL,
});
const provider = createResilientAIProvider(anthropic);

const app = createApp(
  {
    provider,
    clock: { now: () => new Date() },
    approvals: APPROVALS,
  },
  {
    webOrigin: env.WEB_ORIGIN,
  },
);

app.listen(env.API_PORT, () => {
  console.log(`API listening on http://localhost:${env.API_PORT}`);
});
