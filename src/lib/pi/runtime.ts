import {
  createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager,
  type FileEntry,
} from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { mimoModel, resolveMimoBaseUrl } from "@/src/lib/ai/mimo";
import { createReliefExtension } from "./extension";
import { names, type PiContext } from "./tools";

export async function makeSession(context: PiContext, locale: "en" | "ur", entries: FileEntry[]) {
  const baseUrl = resolveMimoBaseUrl();
  const key = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!key || !baseUrl) {
    throw new Error("MiMo model configuration is unavailable");
  }
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerProvider("relief-mimo", {
    name: "MiMo Token Plan",
    api: "anthropic-messages",
    baseUrl,
    models: [{ id: mimoModel, name: "MiMo Flash", reasoning: false, input: ["text", "image"],
      contextWindow: 32768, maxTokens: 1100, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  });
  await modelRuntime.setRuntimeApiKey("relief-mimo", key);
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(), agentDir: process.cwd(), settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    disabledBuiltinExtensions: ["mcp", "codemode", "tool-search"],
    extensionFactories: [createReliefExtension(context, locale)],
    systemPrompt: "Relief Claim Assist. Work only with simulated public data.",
  });
  await resourceLoader.reload();
  const sessionManager = SessionManager.inMemory(process.cwd(), undefined, entries.length ? entries : undefined);
  const model = modelRuntime.getModel("relief-mimo", mimoModel);
  if (!model) throw new Error("MiMo model is unavailable in Pi");
  const { session } = await createAgentSession({
    model, modelRuntime, settingsManager, sessionManager, resourceLoader,
    noTools: "builtin", tools: names, thinkingLevel: "off",
  });
  const active = session.getActiveToolNames();
  if (active.length !== names.length || active.some(tool => !names.includes(tool))) {
    session.dispose();
    throw new Error("The assistant tool allowlist failed to load");
  }
  return { session, sessionManager };
}
