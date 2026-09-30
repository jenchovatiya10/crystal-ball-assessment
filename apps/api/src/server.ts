import { AnthropicProvider } from "./ai/AnthropicProvider.js";
import { FakeAIProvider } from "./ai/FakeAIProvider.js";
import { createResilientAIProvider } from "./ai/resilience.js";
import { createApp } from "./app.js";
import { loadDotenvFiles, loadEnv } from "./config/env.js";
import { APPROVALS } from "./fixtures/approvals.js";

loadDotenvFiles();
const env = loadEnv();

const baseProvider = env.ANTHROPIC_API_KEY
  ? new AnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
    })
  : new FakeAIProvider({
      // No structured queue → Summary/Help take deterministic service fallbacks.
      streamTokens: [
        "Local mode is running without ANTHROPIC_API_KEY. ",
        "Set the key in .env to enable live Anthropic responses.",
      ],
    });

const provider = createResilientAIProvider(baseProvider);

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
  const mode = env.ANTHROPIC_API_KEY ? "anthropic" : "local-fallback";
  console.log(`API listening on http://localhost:${env.API_PORT} (${mode})`);
});
