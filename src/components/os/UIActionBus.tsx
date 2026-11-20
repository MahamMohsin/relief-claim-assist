import type { UIAction } from "@/src/lib/contracts";

export type AgentEvent =
  | { type: "ui_action"; action: UIAction }
  | { type: "phase"; message: string }
  | { type: "message_update"; text: string }
  | { type: "clarification"; text: string }
  | { type: "tool_execution_start"; tool: string }
  | { type: "tool_execution_end"; tool: string }
  | { type: "agent_settled"; model: string }
  | { type: "error"; message: string };

export async function receiveActions(response: Response, onEvent: (event: AgentEvent) => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No assistant stream was returned.");
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const messages = pending.split("\n\n");
      pending = messages.pop() ?? "";
      for (const message of messages) {
        const data = message.split("\n").find(line => line.startsWith("data: "));
        if (data) onEvent(JSON.parse(data.slice(6)) as AgentEvent);
      }
    }
  } finally { reader.releaseLock(); }
}
