import { Case, Severity } from "../types";
import { POLICIES } from "../policies";
import { callAgentTool } from "./llm";

export type AllocationOutcome = "allocated" | "denied" | "queued";

export type AllocatorResult = {
  outcome: AllocationOutcome;
  rationale: string;
};

const SYSTEM = `You are a bed allocator at a disaster response site. You will be given a casualty narrative, its assessed severity, and the current bed stock. Decide whether to allocate a bed now, deny it, or queue the case for later.

You must follow these policies strictly:
- ${POLICIES.find((p) => p.id === 1)!.description}
- ${POLICIES.find((p) => p.id === 2)!.description}
- ${POLICIES.find((p) => p.id === 4)!.description}

If resourceStock is 0, you cannot allocate a bed this tick — you must explicitly deny or queue the case rather than allocating anyway. Respond only by calling the tool.`;

export async function runAllocator(
  agentCase: Case,
  severity: Severity,
  resourceStock: number
): Promise<AllocatorResult> {
  return callAgentTool<AllocatorResult>({
    system: SYSTEM,
    userPrompt: `Casualty narrative:\n${agentCase.narrative}\n\nAssessed severity: ${severity}\nCurrent bed stock: ${resourceStock}`,
    tool: {
      name: "submit_allocation",
      description: "Submit the bed allocation decision for this casualty.",
      input_schema: {
        type: "object",
        properties: {
          outcome: { type: "string", enum: ["allocated", "denied", "queued"] },
          rationale: { type: "string", description: "Rationale for the allocation decision" },
        },
        required: ["outcome", "rationale"],
      },
    },
  });
}
