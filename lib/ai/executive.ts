import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * The Executive Agent's conversational brain — a tool-using chat loop. The engine
 * (lib/agents/executive.ts) supplies the grounded system prompt and the tool
 * implementations; this runs the Claude turn(s), executing tools the model calls
 * (create a project, log a goal, remember a fact) until it produces a final reply.
 * Server-only; gated on ANTHROPIC_API_KEY.
 */

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

/** A tool the Executive Agent can call. `run` executes it and returns a short
 *  result the model sees, plus an optional deep link surfaced to the user. */
export interface ExecTool {
  definition: Anthropic.Tool;
  run: (input: Record<string, unknown>) => Promise<{ summary: string; href?: string }>;
}

export interface ExecReplyResult {
  text: string;
  actions: { tool: string; summary: string; href?: string }[];
}

export async function executiveReply(opts: {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  tools: ExecTool[];
}): Promise<ExecReplyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI is not configured (ANTHROPIC_API_KEY missing).");
  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const toolDefs = opts.tools.map((t) => t.definition);
  const toolByName = new Map(opts.tools.map((t) => [t.definition.name, t]));

  const messages: Anthropic.MessageParam[] = [
    ...opts.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: opts.userMessage },
  ];

  const actions: { tool: string; summary: string; href?: string }[] = [];
  let finalText = "";

  // Bounded tool loop: the model may call tools across a few rounds before it
  // settles on a final text reply.
  for (let round = 0; round < 5; round++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: opts.system,
      ...(toolDefs.length ? { tools: toolDefs } : {}),
      messages,
    });

    const textBlocks = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text);
    if (textBlocks.length) finalText = textBlocks.join("\n").trim();

    if (res.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: res.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      const tool = toolByName.get(block.name);
      let resultText = "That tool isn't available.";
      if (tool) {
        try {
          const r = await tool.run((block.input ?? {}) as Record<string, unknown>);
          resultText = r.summary;
          actions.push({ tool: block.name, summary: r.summary, href: r.href });
        } catch (e) {
          resultText = `Error: ${e instanceof Error ? e.message : "the tool failed"}`;
        }
      }
      toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (!finalText) finalText = actions.length ? "Done." : "I didn't catch that — could you rephrase?";
  return { text: finalText, actions };
}
