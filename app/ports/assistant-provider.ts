export type AssistantJsonSchema = Record<string, unknown>;

export type AssistantProviderMessage = {
  role: "system" | "user";
  content: string;
};

export type AssistantProviderToolDefinition = {
  name: string;
  description: string;
  parameters: AssistantJsonSchema;
};

export type AssistantProviderToolOutput = {
  callId: string;
  output: string;
};

export type AssistantProviderToolCall = {
  callId: string;
  name: string;
  arguments: unknown;
};

export type AssistantProviderRequest = {
  messages: AssistantProviderMessage[];
  tools: AssistantProviderToolDefinition[];
  output: {
    name: string;
    schema: AssistantJsonSchema;
  };
  continuation?: unknown;
  toolOutputs?: AssistantProviderToolOutput[];
  signal: AbortSignal;
};

export type AssistantProviderCompletion =
  | {
      kind: "tool-calls";
      calls: AssistantProviderToolCall[];
      continuation: unknown;
    }
  | {
      kind: "output";
      value: unknown;
    };

export interface AssistantProvider {
  complete(request: AssistantProviderRequest): Promise<AssistantProviderCompletion>;
}
