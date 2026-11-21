"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AlertTriangle,
  CircleDollarSign,
  Flag,
  ImagePlus,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { api } from "@/src/lib/client";
import { prepareDocumentImage } from "@/src/lib/compressImage";
import type { ScamResult } from "@/src/lib/contracts";
import type { ViewContext } from "./MiniApps";
import { speakText, stopSpeaking } from "./os/speech";
import {
  ChatComposer,
  ChatComposerDrawer,
  ChatComposerInput,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
  ChatToolCalls,
} from "@astryxdesign/core/Chat";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
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
import { Thumbnail } from "@astryxdesign/core/Thumbnail";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Token } from "@astryxdesign/core/Token";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { VisuallyHidden } from "@astryxdesign/core/VisuallyHidden";
import { useClipboard } from "@astryxdesign/core/hooks";

type PendingImage = {
  dataUrl: string;
  name: string;
};

type ScamTurn = {
  id: string;
  text: string;
  image?: string;
  imageName?: string;
  askedAt: string;
  answeredAt?: string;
  durationMs?: number;
  status: "checking" | "done" | "error";
  result?: ScamResult;
  error?: string;
  reportState?: "idle" | "reporting" | "reported" | "error";
  reportMessage?: string;
};

const currency = (value: number) => "PKR " + new Intl.NumberFormat("en-PK").format(value);
const pct = (value: number) => `${Math.round(value * 100)}%`;
const titleCase = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, first => first.toUpperCase());
const formatDuration = (ms?: number) => {
  if (ms === undefined) return undefined;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
};
const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Could not complete the scam check. Try again.";

const SAMPLE_PROMPTS = [
  {
    tag: "Legit receipt",
    color: "green" as const,
    heading: "Verify a Raast alert",
    body: "Test a simulated payout SMS with a valid reference",
    prompt: "Raast credited your simulated relief payment of PKR 25,000. Reference: SIM-FATIMA1",
  },
  {
    tag: "Phishing SMS",
    color: "red" as const,
    heading: "Check an OTP & fee link",
    body: "Test a scam asking for an OTP code and processing fee",
    prompt: "URGENT: Send your OTP code and Rs 500 processing fee at https://fake-aid.example to unlock relief aid!",
  },
  {
    tag: "Pressure alert",
    color: "orange" as const,
    heading: "Suspicious urgency message",
    body: "Test an ambiguous message pressuring immediate action",
    prompt: "Urgent representative notice: your relief expires today, verify your details immediately at our booth.",
  },
  {
    tag: "Reference only",
    color: "blue" as const,
    heading: "Look up a reference",
    body: "Cross-check a standalone mock payout code",
    prompt: "Can you check if reference SIM-FATIMA1 is a real payout?",
  },
] as const;

function verdictTone(label: string): {
  banner: "success" | "error" | "warning" | "info";
  badge: "success" | "error" | "warning" | "neutral";
  heading: string;
} {
  if (["genuine", "legitimate"].includes(label)) {
    return { banner: "success", badge: "success", heading: "Looks legitimate" };
  }
  if (label === "scam") {
    return { banner: "error", badge: "error", heading: "Likely scam — do not act" };
  }
  if (label === "suspicious") {
    return { banner: "warning", badge: "warning", heading: "Suspicious — proceed with caution" };
  }
  return { banner: "info", badge: "neutral", heading: "Unverified — confirm independently" };
}

function CopyVerdictButton({ text }: { text: string }) {
  const { copy, isCopied } = useClipboard({ announce: "Verification summary copied" });
  return (
    <IconButton
      variant="ghost"
      size="sm"
      label={isCopied ? "Copied" : "Copy result"}
      tooltip={isCopied ? "Copied" : "Copy result"}
      icon={<Icon icon={isCopied ? "check" : "copy"} size="sm" />}
      onClick={() => void copy(text)}
    />
  );
}

export function ScamChatView({ ctx }: { ctx: ViewContext }) {
  const [turns, setTurns] = useState<ScamTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<PendingImage | null>(null);
  const [inputError, setInputError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeController = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      activeController.current?.abort();
      stopSpeaking();
    };
  }, []);

  function ingestFiles(files: File[]) {
    const file = files.find(item => item.type.startsWith("image/")) ?? files[0];
    if (!file) return;
    setInputError("");
    void prepareDocumentImage(file)
      .then(dataUrl => setAttachment({ dataUrl, name: file.name || "screenshot.png" }))
      .catch(err => setInputError(err instanceof Error ? err.message : "Could not read that image file."));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files ? Array.from(event.target.files) : [];
    if (selected.length) ingestFiles(selected);
    event.target.value = "";
  }

  async function submitCheck(rawText: string, explicitImage?: PendingImage | null) {
    const text = rawText.trim();
    const imageToSend = explicitImage !== undefined ? explicitImage : attachment;
    if ((!text && !imageToSend) || busy) return;
    if (ctx.offline) {
      setInputError("Reconnect to verify messages or screenshots.");
      return;
    }
    if (text.length > 1500) {
      setInputError("Keep pasted messages under 1,500 characters.");
      return;
    }

    setInputError("");
    setDraft("");
    setAttachment(null);
    setBusy(true);

    const id = crypto.randomUUID();
    const askedAt = new Date().toISOString();
    const started = performance.now();
    const controller = new AbortController();
    activeController.current = controller;

    setTurns(prev => [
      ...prev,
      {
        id,
        text,
        image: imageToSend?.dataUrl,
        imageName: imageToSend?.name,
        askedAt,
        status: "checking",
      },
    ]);

    try {
      const result = await api<ScamResult>(
        "check",
        {
          message: text,
          reference: "",
          ...(imageToSend ? { image: imageToSend.dataUrl } : {}),
        },
        controller.signal,
      );
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
                  error: "Verification stopped before completion.",
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

  async function reportMissingPayment(turn: ScamTurn) {
    const ref = turn.result?.payment?.raast_ref || turn.result?.detected_reference;
    if (!ref) return;
    setTurns(prev =>
      prev.map(item =>
        item.id === turn.id ? { ...item, reportState: "reporting", reportMessage: undefined } : item,
      ),
    );
    try {
      if (ctx.offline) {
        await ctx.enqueue("report", { reference: ref, message: turn.text || turn.result?.extracted_text || "" });
        setTurns(prev =>
          prev.map(item =>
            item.id === turn.id
              ? { ...item, reportState: "reported", reportMessage: `Missing payment report for ${ref} queued for sync.` }
              : item,
          ),
        );
      } else {
        await api("report", {
          reference: ref,
          message: turn.text || turn.result?.extracted_text || "",
          key: crypto.randomUUID(),
        });
        setTurns(prev =>
          prev.map(item =>
            item.id === turn.id
              ? { ...item, reportState: "reported", reportMessage: `Missing payment report filed for ${ref}. An officer will review it.` }
              : item,
          ),
        );
      }
    } catch (error) {
      setTurns(prev =>
        prev.map(item =>
          item.id === turn.id
            ? { ...item, reportState: "error", reportMessage: getErrorMessage(error) }
            : item,
        ),
      );
    }
  }

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
    setAttachment(null);
    setInputError("");
  }

  const canSendCurrent = !ctx.offline && !busy && (draft.trim().length > 0 || Boolean(attachment));

  const emptyState = (
    <VStack gap={5} padding={5} hAlign="center" width="100%" maxWidth={680}>
      <EmptyState
        isCompact
        icon={<Icon icon={ShieldCheck} size="lg" color="secondary" />}
        title="Verify any message or screenshot"
        description="Paste an SMS, WhatsApp text, payment reference, or drop/paste a screenshot. Scam Shield inspects it with Vision AI, official policy rules, JEV, and the mock Raast ledger."
      />
      <Grid columns={{ minWidth: 220, max: 2 }} gap={2} width="100%">
        {SAMPLE_PROMPTS.map(sample => (
          <ClickableCard
            key={sample.heading}
            label={sample.heading}
            variant="muted"
            padding={3}
            isDisabled={ctx.offline || busy}
            onClick={() => void submitCheck(sample.prompt, null)}
          >
            <VStack gap={1}>
              <HStack gap={1.5} vAlign="center">
                <Token label={sample.tag} size="sm" color={sample.color} />
                <Heading level={4}>{sample.heading}</Heading>
              </HStack>
              <Text type="supporting" color="secondary">
                {sample.body}
              </Text>
            </VStack>
          </ClickableCard>
        ))}
      </Grid>
    </VStack>
  );

  const composerStatus = ctx.offline
    ? { type: "warning" as const, message: "Offline mode — reconnect to verify messages or screenshots." }
    : inputError
      ? { type: "error" as const, message: inputError }
      : undefined;

  return (
    <VStack width="100%" height="100%" minHeight={0} gap={0}>
      <VisuallyHidden>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleFileChange}
        />
      </VisuallyHidden>

      <Toolbar
        label="Scam Shield controls"
        dividers={["bottom"]}
        size="md"
        startContent={
          <HStack gap={2} vAlign="center">
            <Icon icon={ShieldCheck} size="sm" color="secondary" />
            <VStack gap={0}>
              <Text type="label" weight="semibold">
                Scam Shield
              </Text>
              <Text type="supporting" color="secondary">
                Paste text or drop a screenshot · AI vision + policy + rail check
              </Text>
            </VStack>
          </HStack>
        }
        endContent={
          <HStack gap={2} vAlign="center">
            {ctx.offline && <Token label="Offline" size="sm" color="orange" />}
            {turns.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                label="New check"
                icon={<Icon icon={RotateCcw} size="sm" />}
                onClick={resetChat}
              />
            )}
          </HStack>
        }
      />

      <ChatLayout
        density="balanced"
        emptyState={emptyState}
        composer={
          <ChatComposer
            value={draft}
            onChange={value => {
              setDraft(value);
              if (inputError) setInputError("");
            }}
            onSubmit={value => void submitCheck(value)}
            onStop={handleStop}
            isStopShown={busy}
            isDisabled={ctx.offline}
            status={composerStatus}
            drawer={
              attachment ? (
                <ChatComposerDrawer label="Attached screenshot">
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <Thumbnail
                      src={attachment.dataUrl}
                      alt={attachment.name}
                      label={attachment.name}
                      showRemoveOn="always"
                      onRemove={() => setAttachment(null)}
                    />
                    <VStack gap={0.5}>
                      <Text type="label" weight="medium">
                        {attachment.name}
                      </Text>
                      <Text type="supporting" color="secondary">
                        Ready for Vision AI inspection — add a note or send directly
                      </Text>
                    </VStack>
                  </HStack>
                </ChatComposerDrawer>
              ) : undefined
            }
            input={
              <ChatComposerInput
                label="Paste message or drop screenshot"
                placeholder={
                  ctx.offline
                    ? "Reconnect to verify a message or screenshot…"
                    : "Paste any SMS, WhatsApp message, reference, or Ctrl+V a screenshot…"
                }
                pasteAsToken={false}
                onFiles={ingestFiles}
                onKeyDown={event => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !draft.trim() &&
                    attachment &&
                    !busy &&
                    !ctx.offline
                  ) {
                    event.preventDefault();
                    void submitCheck("");
                  }
                }}
              />
            }
            footerActions={
              <HStack gap={2} vAlign="center">
                <Button
                  variant="ghost"
                  size="sm"
                  label="Attach screenshot"
                  icon={<Icon icon={ImagePlus} size="sm" />}
                  isDisabled={ctx.offline || busy}
                  onClick={() => fileInputRef.current?.click()}
                />
                <Text type="supporting" color="secondary">
                  Never share real OTPs or credentials
                </Text>
              </HStack>
            }
            sendButton={
              !busy && attachment && !draft.trim() ? (
                <IconButton
                  variant="primary"
                  size="sm"
                  label="Check screenshot"
                  tooltip="Check screenshot"
                  icon={<Icon icon="arrowUp" size="sm" />}
                  isDisabled={!canSendCurrent}
                  onClick={() => void submitCheck("")}
                />
              ) : undefined
            }
          />
        }
      >
        {turns.length > 0 ? (
          <ChatMessageList density="balanced" align="top" isStreaming={busy}>
            <ChatSystemMessage variant="divider">
              Scam Shield Verification
            </ChatSystemMessage>

            {turns.map(turn => {
              const tone = turn.result ? verdictTone(turn.result.jev_label) : null;
              const toolCalls =
                turn.status === "checking"
                  ? [
                      {
                        key: `${turn.id}-policy`,
                        name: "policy_rag_search",
                        target: "Scheme fraud & payment rules",
                        status: "running" as const,
                      },
                      {
                        key: `${turn.id}-ai`,
                        name: turn.image ? "mimo_vision_inspect" : "mimo_scam_analyze",
                        target: turn.image ? "Screenshot + message text" : "Message text",
                        status: "running" as const,
                      },
                      {
                        key: `${turn.id}-rail`,
                        name: "raast_rail_lookup",
                        target: "Checking payment ledger",
                        status: "pending" as const,
                      },
                    ]
                  : turn.status === "error"
                    ? [
                        {
                          key: `${turn.id}-err`,
                          name: "scam_shield_verify",
                          target: turn.image ? "Screenshot verification" : "Message verification",
                          status: "error" as const,
                          errorMessage: turn.error,
                        },
                      ]
                    : (turn.result?.tools_used ?? []).map((tool, i) => ({
                        key: `${turn.id}-tool-${i}`,
                        name: tool.name,
                        target: tool.detail ? `${tool.target} · ${tool.detail}` : tool.target,
                        status: tool.status,
                        duration: i === (turn.result?.tools_used?.length ?? 1) - 1 ? formatDuration(turn.durationMs) : undefined,
                      }));

              const reportableRef =
                turn.result?.payment?.raast_ref || turn.result?.detected_reference;

              const spokenSummary = turn.result
                ? `${tone?.heading ?? titleCase(turn.result.jev_label)}. ${turn.result.explanation ?? ""}`
                : "";

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
                      <VStack gap={2}>
                        {turn.image && (
                          <Thumbnail
                            src={turn.image}
                            alt={turn.imageName || "Attached screenshot"}
                            label={turn.imageName || "Screenshot"}
                          />
                        )}
                        {turn.text ? (
                          <Text>{turn.text}</Text>
                        ) : (
                          <Text color="secondary">Attached screenshot for verification</Text>
                        )}
                      </VStack>
                    </ChatMessageBubble>
                  </ChatMessage>

                  <ChatMessage
                    sender="assistant"
                    avatar={<Avatar name="Scam Shield" size="sm" />}
                  >
                    {toolCalls.length > 0 && (
                      <ChatToolCalls
                        label={
                          turn.status === "checking"
                            ? "Running Scam Shield tools"
                            : `Checked with ${toolCalls.length} tools`
                        }
                        calls={toolCalls}
                      />
                    )}

                    <ChatMessageBubble variant="ghost">
                      {turn.status === "checking" && (
                        <Text color="secondary">
                          Inspecting content against official policy rules and the payment rail…
                        </Text>
                      )}

                      {turn.status === "error" && (
                        <Banner
                          status="error"
                          title="Verification could not finish"
                          description={turn.error}
                        />
                      )}

                      {turn.status === "done" && turn.result && tone && (
                        <VStack gap={3} width="100%">
                          <Banner
                            status={tone.banner}
                            title={
                              <HStack gap={2} vAlign="center" wrap="wrap">
                                <Text type="label" weight="semibold">
                                  {tone.heading}
                                </Text>
                                <Badge
                                  label={`${titleCase(turn.result.jev_label)} · ${pct(turn.result.jev_confidence)}`}
                                  variant={tone.badge}
                                />
                              </HStack>
                            }
                            description={turn.result.model}
                          />

                          {turn.result.explanation && (
                            <Markdown density="compact" contentWidth="100%">
                              {turn.result.explanation}
                            </Markdown>
                          )}

                          {turn.result.red_flags && turn.result.red_flags.length > 0 && (
                            <VStack gap={1.5}>
                              <HStack gap={1} vAlign="center">
                                <Icon icon={AlertTriangle} size="sm" color="secondary" />
                                <Text type="supporting" color="secondary" weight="medium">
                                  Signals flagged
                                </Text>
                              </HStack>
                              <HStack gap={1.5} wrap="wrap">
                                {turn.result.red_flags.map(flag => (
                                  <Token
                                    key={flag}
                                    label={flag}
                                    size="sm"
                                    color={turn.result?.jev_label === "scam" ? "red" : "orange"}
                                    icon={<Icon icon={ShieldAlert} size="sm" />}
                                  />
                                ))}
                              </HStack>
                            </VStack>
                          )}

                          <Card variant="muted" padding={3}>
                            <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
                              <HStack gap={2} vAlign="center">
                                <Icon icon={CircleDollarSign} size="sm" color="secondary" />
                                <VStack gap={0.5}>
                                  <Text type="label" weight="semibold">
                                    {turn.result.payment
                                      ? `Simulated rail · ${titleCase(turn.result.payment.status)} · ${currency(turn.result.payment.amount_pkr)}`
                                      : "Simulated payment rail · No matching receipt"}
                                  </Text>
                                  <Text type="supporting" color="secondary">
                                    {turn.result.payment
                                      ? `Reference ${turn.result.payment.raast_ref}`
                                      : turn.result.detected_reference
                                        ? `Reference ${turn.result.detected_reference} was not found in the ledger`
                                        : "No payment reference was found in this message or screenshot"}
                                  </Text>
                                </VStack>
                              </HStack>
                              {reportableRef && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  label={
                                    turn.reportState === "reported"
                                      ? "Reported"
                                      : "Report missing payment"
                                  }
                                  icon={<Icon icon={Flag} size="sm" />}
                                  isLoading={turn.reportState === "reporting"}
                                  isDisabled={turn.reportState === "reported"}
                                  onClick={() => void reportMissingPayment(turn)}
                                />
                              )}
                            </HStack>
                          </Card>

                          {turn.reportMessage && (
                            <Banner
                              status={turn.reportState === "error" ? "error" : "success"}
                              title={turn.reportMessage}
                            />
                          )}

                          {turn.result.extracted_text && (
                            <Card variant="muted" padding={3}>
                              <Collapsible
                                defaultIsOpen={false}
                                trigger={
                                  <Text type="label" weight="medium">
                                    Text read from screenshot
                                  </Text>
                                }
                              >
                                <VStack paddingBlockStart={2}>
                                  <Text type="supporting" color="secondary">
                                    {turn.result.extracted_text}
                                  </Text>
                                </VStack>
                              </Collapsible>
                            </Card>
                          )}

                          {turn.result.citations && turn.result.citations.length > 0 && (
                            <VStack gap={1.5} width="100%">
                              <Text type="supporting" color="secondary" weight="medium">
                                Policy guidance used
                              </Text>
                              {turn.result.citations.map(section => (
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
                                    <VStack gap={1} paddingBlockStart={2}>
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
                        </VStack>
                      )}
                    </ChatMessageBubble>

                    {turn.status !== "checking" && (
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
                                <CopyVerdictButton text={spokenSummary} />
                                <IconButton
                                  variant="ghost"
                                  size="sm"
                                  label="Read result aloud"
                                  tooltip="Read result aloud"
                                  icon={<Icon icon={Volume2} size="sm" />}
                                  onClick={() =>
                                    void speakText(
                                      spokenSummary,
                                      ctx.voiceLang,
                                      ctx.lite || ctx.offline,
                                    )
                                  }
                                />
                              </>
                            )}
                            {turn.status === "error" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                label="Retry"
                                isDisabled={busy || ctx.offline}
                                onClick={() =>
                                  void submitCheck(
                                    turn.text,
                                    turn.image
                                      ? { dataUrl: turn.image, name: turn.imageName || "screenshot.png" }
                                      : null,
                                  )
                                }
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
