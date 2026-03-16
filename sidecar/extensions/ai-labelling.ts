import { complete, type Model, type Api } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SUMMARY_PROMPT =
  "Summarize the user's request in 5-10 words max. Output ONLY the summary, nothing else. No quotes, no punctuation at the end.";

const HAIKU_MODEL_ID = "claude-haiku-4-5";

async function pickCheapModel(ctx: {
  model: Model<Api> | null;
  modelRegistry: {
    find: (p: string, id: string) => Model<Api> | undefined;
    getApiKey: (m: Model<Api>) => Promise<string | undefined>;
  };
}): Promise<{ model: Model<Api>; apiKey: string } | null> {
  const haiku = ctx.modelRegistry.find("anthropic", HAIKU_MODEL_ID);
  if (haiku) {
    const key = await ctx.modelRegistry.getApiKey(haiku);
    if (key) return { model: haiku, apiKey: key };
  }
  if (ctx.model) {
    const key = await ctx.modelRegistry.getApiKey(ctx.model);
    if (key) return { model: ctx.model, apiKey: key };
  }
  return null;
}

export default function (pi: ExtensionAPI) {
  let named = false;

  pi.on("session_start", () => {
    // Check if session already has a name
    named = !!pi.getSessionName() && pi.getSessionName() !== "New Chat";
  });

  pi.on("input", async (event, ctx) => {
    if (named) return;

    // We only want to name based on the first real user input
    // If it's a code block or something very technical, we still try to summarize it
    const userPrompt = event.text.trim();
    if (!userPrompt) return;

    named = true;

    // Set a temporary name immediately so something shows up
    const tempName = userPrompt.length > 50 ? userPrompt.slice(0, 47) + "..." : userPrompt;
    pi.setSessionName(tempName);

    // Summarize in the background with a cheap model
    const cheap = await pickCheapModel(ctx as any);
    if (!cheap) return;

    try {
      const response = await complete(
        cheap.model,
        {
          systemPrompt: SUMMARY_PROMPT,
          messages: [{ role: "user", content: [{ type: "text", text: userPrompt }], timestamp: Date.now() }],
        },
        { apiKey: cheap.apiKey },
      );

      const summary = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim();

      if (summary) {
        pi.setSessionName(summary);
      }
    } catch (err) {
      console.error("[ai-labelling] Summary generation failed:", err);
      // Fallback is already set to tempName
    }
  });
}
