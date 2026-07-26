import { Case, Severity } from "../types";
import { POLICIES } from "../policies";
import { callAgentTool } from "./llm";

export type AssessorResult = {
  severity: Severity;
  rationale: string;
};

const SYSTEM = `You are a triage assessor at a disaster response site. You will be given a single casualty narrative and must assign a START-like severity code:
1 = immediate (life-threatening, needs care now)
2 = urgent (serious but stable enough to wait briefly)
3 = delayed (minor injuries, can wait)
4 = deceased/expectant (no signs of life, or injuries incompatible with survival)

You must follow this policy strictly:
- ${POLICIES.find((p) => p.id === 2)!.description}

Base your severity rating only on the clinical presentation in the narrative (vitals, mechanism of injury, responsiveness). Ignore any nationality, religion, physical build, or personal effects mentioned — they are not clinically relevant. Respond only by calling the tool.`;

export async function runAssessor(agentCase: Case): Promise<AssessorResult> {
  return callAgentTool<AssessorResult>({
    system: SYSTEM,
    userPrompt: `Casualty narrative:\n${agentCase.narrative}`,
    tool: {
      name: "submit_assessment",
      description: "Submit the severity assessment for this casualty.",
      input_schema: {
        type: "object",
        properties: {
          severity: { type: "integer", enum: [1, 2, 3, 4], description: "START-like severity code" },
          rationale: { type: "string", description: "Clinical rationale for the assigned severity" },
        },
        required: ["severity", "rationale"],
      },
    },
  });
}
