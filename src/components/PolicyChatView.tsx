"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, RotateCcw, Sparkles, Volume2 } from "lucide-react";
import { api } from "@/src/lib/client";
import type { PolicyAnswer } from "@/src/lib/contracts";
import type { ViewContext } from "./MiniApps";
import { speakText, stopSpeaking } from "./os/speech";
import { cuaEngine } from "./os/cuaEngine";
import {
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
  ChatToolCalls,
} from "@astryxdesign/core/Chat";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Token } from "@astryxdesign/core/Token";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { useClipboard } from "@astryxdesign/core/hooks";

type PolicyTurn = {
  id: string;
  question: string;
  askedAt: string;
  answeredAt?: string;
  durationMs?: number;
  status: "searching" | "done" | "error";
  result?: PolicyAnswer;
  error?: string;
};

const STARTER_PROMPTS = [
  {
    code: "A1",
    heading: "Eligibility & multiple claims",
    body: "Who can apply and how many claims a household can file",
    prompt: "Who is eligible to apply, and can a household file multiple claims?",
  },
  {
    code: "A2",
    heading: "Household income cap",
    body: "How monthly household income and size are checked",
    prompt: "What is the household income cap?",
  },
  {
    code: "A4",
    heading: "Required documents & proof",
    body: "Identity cards, income slips, and blurry document replacement",
    prompt: "What proof and documents do I need to submit?",
  },
  {
    code: "A6",
    heading: "Missing payment & scam safety",
    body: "Reporting missing Raast payouts and spotting fake OTP messages",
    prompt: "How do I report a missing payment or spot an OTP scam?",
  },
] as const;

const FOLLOW_UP_POOL = [
  { code: "A1", label: "Can we apply again?", prompt: "Can a household apply again for a second claim?" },
  { code: "A2", label: "Income cap rules", prompt: "What is the household income cap?" },
  { code: "A3", label: "Widow priority", prompt: "Do widows get priority for urgent hardship cases?" },
  { code: "A4", label: "Required documents", prompt: "What identity documents and proof are required?" },
  { code: "A5", label: "Raast payouts", prompt: "How do Raast payments and receipts work?" },
  { code: "A6", label: "Missing payment dispute", prompt: "How do I report a missing payment dispute?" },
  { code: "A7", label: "Helper consent & privacy", prompt: "How can I revoke helper consent or request a correction?" },
  { code: "A8", label: "OTP & fee safety", prompt: "Does the relief scheme ever ask for an OTP or fee?" },
] as const;

const formatDuration = (ms?: number) => {
  if (ms === undefined) return undefined;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Could not query the policy registry. Try again.";

function CopyAnswerButton({ text }: { text: string }) {
  const { copy, isCopied } = useClipboard({ announce: "Policy answer copied" });
  return (
    <IconButton
      variant="ghost"
      size="sm"
      label={isCopied ? "Copied" : "Copy answer"}
      tooltip={isCopied ? "Copied" : "Copy answer"}
      icon={<Icon icon={isCopied ? "check" : "copy"} size="sm" />}
      onClick={() => void copy(text)}
    />
  );
}

export function PolicyChatView({ ctx }: { ctx: ViewContext }) {
  const [turns, setTurns] = useState<PolicyTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState("");
  const [busy, setBusy] = useState(false);
  const activeController = useRef<AbortController | null>(null);
  const askRef = useRef<(raw: string) => Promise<void>>(async () => {});

  useEffect(() => {
    cuaEngine.policy = {
      setDraft: value => {
        setDraft(value);
        setInputError("");
      },
      ask: question => {
        void askRef.current(question);
      },
    };
    return () => {
      if (cuaEngine.policy) cuaEngine.policy = null;
      activeController.current?.abort();
      stopSpeaking();
    };
  }, []);

  const latestVersion = [...turns].reverse().find(t => t.result?.policy_version)?.result?.policy_version;
  const citedCodes = new Set(
    turns.flatMap(t => t.result?.citations.map(c => c.section_code) ?? []),
  );
  const followUps = FOLLOW_UP_POOL.filter(item => !citedCodes.has(item.code)).slice(0, 3);

  async function askQuestion(raw: string) {
    const question = raw.trim();
    if (!question || busy) return;
    if (ctx.offline) {
      setInputError("Reconnect to search the official policy registry.");
      return;
    }
    if (question.length < 3) {
      setInputError("Ask a slightly longer question (at least 3 characters).");
      return;
    }
    if (question.length > 500) {
      setInputError("Keep policy questions under 500 characters.");
      return;
    }

    setInputError("");
    setDraft("");
    setBusy(true);

    const id = crypto.randomUUID();
    const askedAt = new Date().toISOString();
    const started = performance.now();
    const controller = new AbortController();
    activeController.current = controller;

    setTurns(prev => [
      ...prev,
      { id, question, askedAt, status: "searching" },
    ]);

    try {
      const result = await api<PolicyAnswer>("policy", { question }, controller.signal);
      if (controller.signal.aborted) return;
      const durationMs = Math.max(1, Math.round(performance.now() - started));
      setTurns(prev =>
        prev.map(turn =>
          turn.id === id
            ? {
                ...turn,
                status: "done",
                result,
                durationMs,
                answeredAt: new Date().toISOString(),
              }
            : turn,
        ),
      );
    } catch (error) {
      if (controller.signal.aborted) {
        setTurns(prev =>
          prev.map(turn =>
            turn.id === id
              ? {
                  ...turn,
                  status: "error",
                  error: "Search stopped before completion.",
                  answeredAt: new Date().toISOString(),
                }
              : turn,
          ),
        );
        return;
      }
      setTurns(prev =>
        prev.map(turn =>
          turn.id === id
            ? {
                ...turn,
                status: "error",
                error: getErrorMessage(error),
                answeredAt: new Date().toISOString(),
              }
            : turn,
        ),
      );
    } finally {
      if (activeController.current === controller) {
        activeController.current = null;
        setBusy(false);
      }
    }
  }

  askRef.current = askQuestion;

  function handleStop() {
    activeController.current?.abort();
    activeController.current = null;
    setBusy(false);
  }

  function resetChat() {
    activeController.current?.abort();
    activeController.current = null;
    stopSpeaking();
    setBusy(false);
    setTurns([]);
    setDraft("");
    setInputError("");
  }

  const emptyState = (
    <VStack gap={5} padding={5} hAlign="center" width="100%" maxWidth={680}>
      <EmptyState
        isCompact
        icon={<Icon icon={BookOpen} size="lg" color="secondary" />}
        title="Ask the official scheme policy"
        description="Ask in English or Urdu. Every reply quotes the live policy registry with exact section citations, or tells you clearly if a topic is not covered."
      />
      <Grid columns={{ minWidth: 220, max: 2 }} gap={2} width="100%">
        {STARTER_PROMPTS.map(item => (
          <ClickableCard
            key={item.code}
            label={item.heading}
            variant="muted"
            padding={3}
            isDisabled={ctx.offline || busy}
            onClick={() => void askQuestion(item.prompt)}
          >
            <VStack gap={1}>
              <Heading level={4}>{item.heading}</Heading>
              <Text type="supporting" color="secondary">
                {item.body}
              </Text>
            </VStack>
          </ClickableCard>
        ))}
      </Grid>
    </VStack>
  );

  const composerStatus = ctx.offline
    ? { type: "warning" as const, message: "Offline mode — reconnect to query the policy registry." }
    : inputError
      ? { type: "error" as const, message: inputError }
      : undefined;

  return (
    <VStack width="100%" height="100%" minHeight={0} gap={0}>

      <ChatLayout
        density="balanced"
        emptyState={emptyState}
        composer={
          <div data-cua="policy-composer" style={{ width: "100%" }}>
            <ChatComposer
              value={draft}
              onChange={value => {
                setDraft(value);
                if (inputError) setInputError("");
              }}
              onSubmit={value => void askQuestion(value)}
              onStop={handleStop}
              isStopShown={busy}
              isDisabled={ctx.offline}
              status={composerStatus}
              placeholder={
                ctx.offline
                  ? "Reconnect to ask a policy question…"
                  : "Ask about eligibility, income cap, documents, Raast payouts, or scams…"
              }
            />
          </div>
        }
      >
        {turns.length > 0 ? (
          <ChatMessageList density="balanced" align="top" isStreaming={busy}>
            <ChatSystemMessage variant="divider">
              Scheme Policy Registry
            </ChatSystemMessage>

            {turns.map((turn, index) => {
              const isLatest = index === turns.length - 1;
              const citations = turn.result?.citations ?? [];
              const markdownText =
                citations.length > 0
                  ? citations.map(c => `${c.content} [${c.section_code}]`).join("\n\n")
                  : turn.result?.answer ?? "";
              const sources =
                citations.length > 0
                  ? Object.fromEntries(
                      citations.map(c => [
                        c.section_code,
                        { title: `§ ${c.section_code} · ${c.title}` },
                      ]),
                    )
                  : undefined;

              return (
                <VStack key={turn.id} gap={2} width="100%">
                  <ChatMessage sender="user">
                    <ChatMessageBubble
                      metadata={
                        <ChatMessageMetadata
                          timestamp={<Timestamp value={turn.askedAt} format="time" />}
                          status={turn.status === "error" ? "error" : "delivered"}
                        />
                      }
                    >
                      {turn.question}
                    </ChatMessageBubble>
                  </ChatMessage>

                  <ChatMessage
                    sender="assistant"
                    avatar={<Avatar name="Policy Registry" size="sm" />}
                  >
                    <ChatToolCalls
                      calls={[
                        {
                          key: `${turn.id}-rag`,
                          name: "policy_rag_search",
                          target:
                            turn.status === "done" && citations.length > 0
                              ? citations.map(c => `§ ${c.section_code} ${c.title}`).join(", ")
                              : turn.question,
                          status:
                            turn.status === "searching"
                              ? "running"
                              : turn.status === "error"
                                ? "error"
                                : "complete",
                          node: turn.result
                            ? `policy-v${turn.result.policy_version}`
                            : "scheme-registry",
                          duration: formatDuration(turn.durationMs),
                          errorMessage: turn.error,
                        },
                      ]}
                    />

                    <ChatMessageBubble variant="ghost">
                      {turn.status === "searching" && (
                        <Text color="secondary">
                          Searching official policy sections…
                        </Text>
                      )}

                      {turn.status === "error" && (
                        <Banner
                          status="error"
                          title="Policy lookup failed"
                          description={turn.error}
                        />
                      )}

                      {turn.status === "done" && turn.result && (
                        <VStack gap={3} width="100%">
                          {citations.length > 0 ? (
                            <Markdown
                              density="compact"
                              contentWidth="100%"
                              sources={sources}
                              citationStyle="label"
                            >
                              {markdownText}
                            </Markdown>
                          ) : (
                            <Banner
                              status="warning"
                              title={turn.result.answer}
                              description={`No matching clause was found in Policy v${turn.result.policy_version}. Try asking about eligibility, income cap, widow priority, required documents, Raast payments, consent, or scam safety.`}
                            />
                          )}

                          {citations.length > 0 && (
                            <VStack gap={1.5} width="100%">
                              <Text type="supporting" color="secondary" weight="medium">
                                Quoted policy sections ({citations.length})
                              </Text>
                              {citations.map(section => (
                                <Card key={section.id} variant="muted" padding={3}>
                                  <Collapsible
                                    defaultIsOpen={false}
                                    trigger={
                                      <HStack gap={2} vAlign="center" wrap="wrap">
                                        <Token
                                          label={`§ ${section.section_code}`}
                                          size="sm"
                                          color="blue"
                                        />
                                        <Text type="label" weight="medium">
                                          {section.title}
                                        </Text>
                                      </HStack>
                                    }
                                  >
                                    <VStack gap={1.5} paddingBlockStart={2}>
                                      <Text>{section.content}</Text>
                                      <Text type="supporting" color="secondary">
                                        Policy v{section.policy_version} · Effective{" "}
                                        {section.effective_date}
                                      </Text>
                                    </VStack>
                                  </Collapsible>
                                </Card>
                              ))}
                            </VStack>
                          )}

                          {isLatest && !busy && followUps.length > 0 && (
                            <VStack gap={1.5} paddingBlockStart={1}>
                              <HStack gap={1} vAlign="center">
                                <Icon icon={Sparkles} size="sm" color="secondary" />
                                <Text type="supporting" color="secondary">
                                  Related topics
                                </Text>
                              </HStack>
                              <HStack gap={1.5} wrap="wrap">
                                {followUps.map(item => (
                                  <Token
                                    key={item.code}
                                    label={item.label}
                                    size="sm"
                                    isDisabled={ctx.offline}
                                    onClick={() => void askQuestion(item.prompt)}
                                  />
                                ))}
                              </HStack>
                            </VStack>
                          )}
                        </VStack>
                      )}
                    </ChatMessageBubble>

                    {turn.status !== "searching" && (
                      <ChatMessageMetadata
                        timestamp={
                          turn.answeredAt ? (
                            <Timestamp value={turn.answeredAt} format="time" />
                          ) : undefined
                        }
                        footer={
                          <HStack gap={1} vAlign="center">
                            {turn.result && (
                              <>
                                <CopyAnswerButton text={turn.result.answer} />
                                <IconButton
                                  variant="ghost"
                                  size="sm"
                                  label="Read answer aloud"
                                  tooltip="Read answer aloud"
                                  icon={<Icon icon={Volume2} size="sm" />}
                                  onClick={() =>
                                    void speakText(
                                      turn.result!.answer,
                                      ctx.voiceLang,
                                      ctx.lite || ctx.offline,
                                    )
                                  }
                                />
                                <Text type="supporting" color="secondary">
                                  Policy v{turn.result.policy_version}
                                  {turn.result.effective_date
                                    ? ` · ${turn.result.effective_date}`
                                    : ""}
                                </Text>
                              </>
                            )}
                            {turn.status === "error" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                label="Retry"
                                isDisabled={busy || ctx.offline}
                                onClick={() => void askQuestion(turn.question)}
                              />
                            )}
                          </HStack>
                        }
                      />
                    )}
                  </ChatMessage>
                </VStack>
              );
            })}
          </ChatMessageList>
        ) : null}
      </ChatLayout>
    </VStack>
  );
}
