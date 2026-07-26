import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// Model + provider resolution. Set POLICYTOWN_MODEL to switch model/provider
// for a whole run (e.g. gpt-4o-mini); it falls back to ANTHROPIC_MODEL, then
// Haiku. The provider is inferred from the model id, so no other config is
// needed to run a cross-provider replication.
export const MODEL = process.env.POLICYTOWN_MODEL || process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
export const PROVIDER: "openai" | "anthropic" = /^(gpt|o[0-9]|chatgpt)/i.test(MODEL) ? "openai" : "anthropic";

let anthropic: Anthropic | null = null;
let openai: OpenAI | null = null;

function getAnthropic(): Anthropic {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see .env.local.example).");
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

function getOpenAI(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
      throw new Error(
        `OPENAI_API_KEY is not set but model "${MODEL}" is an OpenAI model. Add OPENAI_API_KEY to .env.local.`
      );
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

export type ToolSchema = {
  name: string;
  description: string;
  input_schema: Anthropic.Messages.Tool["input_schema"];
};

// OpenAI structured-outputs ("strict") guarantees the model returns valid
// JSON matching the schema — without it, gpt-4o-mini intermittently emits
// invalid JSON and extra array entries on the larger tools. Strict mode
// requires every object to set additionalProperties:false and list all its
// properties as required, and does not support minItems/maxItems, so this
// transforms our Anthropic-style schema into a strict-compatible one.
function toStrictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictSchema);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "minItems" || k === "maxItems") continue;
      out[k] = toStrictSchema(v);
    }
    if (out.type === "object" && out.properties && typeof out.properties === "object") {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties as Record<string, unknown>);
    }
    return out;
  }
  return node;
}

/**
 * Calls the configured model with a single forced tool, so every agent
 * response is structured JSON. Both providers use the same JSON Schema (the
 * tool's input_schema doubles as OpenAI's function parameters), so the agent
 * modules are provider-agnostic and only this wrapper branches.
 */
export async function callAgentTool<T>(opts: { system: string; userPrompt: string; tool: ToolSchema }): Promise<T> {
  // The Control tool emits the most text (severity + allocation + all five
  // policy verdicts + an overall rationale); 1024 truncated it mid-JSON on
  // gpt-4o-mini, so the tool arguments failed to parse. 4096 gives ample
  // headroom for every tool; unused ceiling costs nothing.
  const MAX_TOKENS = 4096;

  if (PROVIDER === "openai") {
    // Strict mode makes valid JSON the norm, but gpt-4o-mini still emits
    // invalid JSON on rare calls (long outputs / near-refusals). Retry a few
    // times so one bad call can't fail a whole tick and lose the episode.
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await getOpenAI().chat.completions.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: opts.tool.name,
              description: opts.tool.description,
              parameters: toStrictSchema(opts.tool.input_schema) as Record<string, unknown>,
              strict: true,
            },
          },
        ],
        tool_choice: { type: "function", function: { name: opts.tool.name } },
      });
      const call = res.choices[0]?.message?.tool_calls?.[0];
      if (!call || call.type !== "function") {
        lastErr = new Error(`OpenAI model did not return a function call for tool ${opts.tool.name}`);
        continue;
      }
      try {
        return JSON.parse(call.function.arguments) as T;
      } catch {
        lastErr = new Error(`OpenAI tool arguments were not valid JSON for tool ${opts.tool.name}`);
      }
    }
    throw lastErr ?? new Error(`OpenAI call failed for tool ${opts.tool.name}`);
  }

  const res = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: opts.system,
    messages: [{ role: "user", content: opts.userPrompt }],
    tools: [{ name: opts.tool.name, description: opts.tool.description, input_schema: opts.tool.input_schema }],
    tool_choice: { type: "tool", name: opts.tool.name },
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error(`Agent did not return a tool_use block for tool ${opts.tool.name}`);
  }
  return block.input as T;
}
