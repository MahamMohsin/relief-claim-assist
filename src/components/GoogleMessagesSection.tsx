"use client";

import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Inbox,
  KeyRound,
  LoaderCircle,
  MessageSquareText,
  Phone,
  Power,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Icon } from "@astryxdesign/core/Icon";

type GoogleMessagesStatusResponse = {
  isAdmin: boolean;
  paired?: boolean;
  status: "disconnected" | "starting" | "waiting_auth" | "qr_ready" | "connected" | "error";
  adminPhone: string | null;
  gatewayRunning: boolean;
  qrDataUrl?: string | null;
  pairedAt?: string | null;
  autoPromptUnknown?: boolean;
  lastError?: string | null;
  activeSmsSessions?: number;
  activeUsers?: Array<{
    userId: string;
    name: string;
    role: string;
    linkedPhone: string | null;
  }>;
};

type UserTokenResponse = {
  userId: string;
  name: string;
  role: string;
  token: string;
  linkedPhone: string | null;
  isLinked: boolean;
};

type LiveSmsMessage = {
  id: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  text: string;
  timestamp: string;
  authenticatedUser?: string | null;
  authenticatedRole?: string | null;
  toolsUsed?: string[];
  source?: "google_messages_live" | "simulator";
};

export function GoogleMessagesSection({
  personaId,
  userName,
  roleTitle,
  isAdmin,
}: {
  personaId: string;
  userName: string;
  roleTitle: string;
  isAdmin: boolean;
}) {
  const [gmStatus, setGmStatus] = useState<GoogleMessagesStatusResponse | null>(null);
  const [tokenInfo, setTokenInfo] = useState<UserTokenResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneDirty, setPhoneDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resettingKey, setResettingKey] = useState(false);
  const [copiedMode, setCopiedMode] = useState<"cmd" | "key" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Admin-only live SMS feed & simulator
  const [smsFeed, setSmsFeed] = useState<LiveSmsMessage[]>([]);
  const [simPhone, setSimPhone] = useState("+92 301 5551234");
  const [simText, setSimText] = useState("");
  const [simBusy, setSimBusy] = useState(false);
  const [simLog, setSimLog] = useState<Array<{ sender: "sms" | "bot"; text: string; time: string }>>([]);

  async function fetchStatusAndToken(silent = false) {
    try {
      if (!silent) setLoading(true);
      const [statusRes, tokenRes] = await Promise.all([
        fetch("/api/google-messages/status", { cache: "no-store" }),
        fetch("/api/whatsapp/token", { cache: "no-store" }),
      ]);

      if (statusRes.ok) {
        const sJson = (await statusRes.json()) as GoogleMessagesStatusResponse;
        setGmStatus(sJson);
        if (!phoneDirty && sJson.adminPhone) {
          setPhoneInput(sJson.adminPhone);
        }
      }
      if (tokenRes.ok) {
        const tJson = (await tokenRes.json()) as UserTokenResponse;
        setTokenInfo(tJson);
      }

      if (isAdmin) {
        const feedRes = await fetch("/api/google-messages/webhook?limit=40", { cache: "no-store" });
        if (feedRes.ok) {
          const fJson = (await feedRes.json()) as { messages: LiveSmsMessage[] };
          setSmsFeed(fJson.messages || []);
        }
      }
    } catch {
      // Ignored on transient poll
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    setTokenInfo(null);
    setNotice("");
    setError("");
    setSmsFeed([]);
    setSimLog([]);
    void fetchStatusAndToken(false);

    const interval = setInterval(() => {
      void fetchStatusAndToken(true);
    }, 3500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaId, isAdmin]);

  async function copyText(text: string, mode: "cmd" | "key") {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMode(mode);
      setTimeout(() => setCopiedMode(null), 2000);
    } catch {
      setError("Could not access clipboard. Please select and copy manually.");
    }
  }

  async function handleRegenerateKey() {
    setResettingKey(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/whatsapp/token", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to regenerate login key.");
      setTokenInfo(data);
      setNotice("New personal SMS login key generated. Any old linked SMS phone has been logged out.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate key.");
    } finally {
      setResettingKey(false);
    }
  }

  async function callAdminAction(
    action: "pair" | "open_window" | "refresh_qr" | "set_phone" | "toggle_auto_prompt" | "disconnect",
    extra: Record<string, unknown> = {},
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/google-messages/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, phone: phoneInput.trim() || undefined, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Google Messages action failed.");
      setGmStatus(prev => ({
        isAdmin: true,
        ...prev,
        ...data,
      }));
      setPhoneDirty(false);

      if (action === "pair") {
        setNotice("Starting Google Messages bridge... A live QR code will appear below in a few seconds.");
      } else if (action === "open_window") {
        setNotice("Opened Google Messages pairing window on the host machine. Scan QR or complete pairing there.");
      } else if (action === "set_phone") {
        setNotice("Admin SMS number saved! Users can now see this number for /login.");
      } else if (action === "disconnect") {
        setNotice("Google Messages session unpaired and disconnected.");
      } else if (action === "refresh_qr") {
        setNotice("Refreshing Google Messages QR code...");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update Google Messages gateway.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSimulateSms() {
    const text = simText.trim();
    const from = simPhone.trim();
    if (!text || !from || simBusy) return;
    setSimBusy(true);
    setSimText("");

    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setSimLog(prev => [...prev, { sender: "sms", text: `${from}: ${text}`, time: now }]);

    try {
      const res = await fetch("/api/google-messages/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, text, source: "simulator" }),
      });
      const data = await res.json();
      setSimLog(prev => [
        ...prev,
        {
          sender: "bot",
          text: data.reply || data.error || "(No reply triggered)",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
      void fetchStatusAndToken(true);
    } catch {
      setSimLog(prev => [
        ...prev,
        { sender: "bot", text: "Failed to reach SMS webhook.", time: now },
      ]);
    } finally {
      setSimBusy(false);
    }
  }

  const isPaired = gmStatus?.status === "connected" || Boolean(gmStatus?.paired);
  const isStarting = gmStatus?.status === "starting" || gmStatus?.status === "waiting_auth";
  const isQrReady = gmStatus?.status === "qr_ready" && Boolean(gmStatus?.qrDataUrl);
  const loginCommand = tokenInfo?.token ? `/login ${tokenInfo.token}` : "";

  const statusBadgeLabel = isPaired
    ? "Paired & Live"
    : isQrReady
      ? "Scan QR Code"
      : isStarting
        ? "Starting Browser…"
        : gmStatus?.status === "error"
          ? "Error"
          : "Not Paired";

  const statusBadgeVariant = isPaired
    ? "success"
    : isQrReady || isStarting
      ? "warning"
      : gmStatus?.status === "error"
        ? "error"
        : "neutral";

  return (
    <Card padding={5}>
      <VStack gap={4} width="100%">
        {/* Header */}
        <HStack justify="between" vAlign="center" wrap="wrap" gap={3} width="100%">
          <HStack gap={3} vAlign="center">
            <Icon icon={MessageSquareText} size="lg" />
            <VStack gap={0.5}>
              <Heading level={3}>Direct SMS via Google Messages</Heading>
              <Text size="sm" color="secondary">
                {isAdmin
                  ? "Pair your Android Google Messages via Playwright so any user can text your number with /login {key} and chat directly over SMS."
                  : "Text the admin's paired Google Messages number with your personal /login key to chat with Relief Assist via direct SMS."}
              </Text>
            </VStack>
          </HStack>
          <Badge label={`SMS Gateway: ${statusBadgeLabel}`} variant={statusBadgeVariant} />
        </HStack>

        {notice && <Banner status="success" title={notice} />}
        {error && <Banner status="error" title={error} />}
        {isAdmin && gmStatus?.lastError && (
          <Banner status="error" title={`Gateway error: ${gmStatus.lastError}`} />
        )}

        {/* SECTION A: Personal /login {key} Card (Every user gets their own isolated SMS key) */}
        <Card padding={4}>
          <VStack gap={3} width="100%">
            <HStack justify="between" vAlign="center" wrap="wrap" gap={2} width="100%">
              <HStack gap={2} vAlign="center">
                <Icon icon={KeyRound} size="sm" />
                <Heading level={4}>Your Personal Direct SMS Login Key</Heading>
              </HStack>
              <Badge
                label={tokenInfo?.isLinked ? `Linked: ${tokenInfo.linkedPhone}` : "SMS Not Linked Yet"}
                variant={tokenInfo?.isLinked ? "success" : "neutral"}
              />
            </HStack>

            {/* Gateway Phone Banner */}
            {isPaired && gmStatus?.adminPhone ? (
              <Banner
                status="success"
                title={`SMS Gateway Online · Send SMS to ${gmStatus.adminPhone}`}
              />
            ) : isPaired ? (
              <Banner
                status="info"
                title="Google Messages is paired & listening. Send your /login command via SMS to the Admin's paired phone number."
              />
            ) : (
              <Banner
                status="info"
                title={
                  gmStatus?.adminPhone
                    ? `Admin SMS number: ${gmStatus.adminPhone} (waiting for Admin to pair Google Messages).`
                    : "Waiting for Admin to pair Google Messages below. Your personal /login key is ready to copy."
                }
              />
            )}

            <Text size="sm" color="secondary">
              Scoped strictly to <strong>{userName}</strong> ({roleTitle}). Text the command below to{" "}
              <strong>{gmStatus?.adminPhone || "the Admin's paired SMS number"}</strong> to authenticate your phone and start chatting via SMS:
            </Text>

            <HStack gap={2} vAlign="end" wrap="wrap" width="100%">
              <TextInput
                label="SMS Login Command"
                value={loading && !loginCommand ? "Loading your key…" : loginCommand}
                onChange={() => {}}
                isReadOnly
              />
              <Button
                variant="primary"
                size="sm"
                label={copiedMode === "cmd" ? "Copied /login!" : "Copy /login Command"}
                icon={<Icon icon={copiedMode === "cmd" ? Check : Copy} size="sm" />}
                isDisabled={!loginCommand}
                onClick={() => void copyText(loginCommand, "cmd")}
              />
              <Button
                variant="secondary"
                size="sm"
                label={copiedMode === "key" ? "Key Copied" : "Copy Key"}
                icon={<Icon icon={copiedMode === "key" ? Check : Copy} size="sm" />}
                isDisabled={!tokenInfo?.token}
                onClick={() => void copyText(tokenInfo?.token || "", "key")}
              />
              <Button
                variant="secondary"
                size="sm"
                label={resettingKey ? "Rotating…" : "Regenerate Key"}
                icon={<Icon icon={RefreshCw} size="sm" />}
                isDisabled={resettingKey}
                onClick={() => void handleRegenerateKey()}
              />
            </HStack>

            <Text size="sm" color="secondary">
              SMS Commands once paired: <code>/login {tokenInfo?.token || "<your-key>"}</code> to start ·{" "}
              <code>/whoami</code> to check account · <code>/help</code> for role actions · <code>/logout</code> to unlink your phone.
            </Text>
          </VStack>
        </Card>

        {/* SECTION B: Admin-Only Google Messages Pairing Controls */}
        {isAdmin && (
          <Card padding={4}>
            <VStack gap={4} width="100%">
              <HStack justify="between" vAlign="center" wrap="wrap" gap={2} width="100%">
                <HStack gap={2} vAlign="center">
                  <Icon icon={Smartphone} size="sm" />
                  <Heading level={4}>Admin Google Messages Pairing (Playwright Bridge)</Heading>
                </HStack>
                <Badge
                  label={`${gmStatus?.activeSmsSessions ?? 0} Active SMS User${(gmStatus?.activeSmsSessions ?? 0) === 1 ? "" : "s"}`}
                  variant="info"
                />
              </HStack>

              {/* Admin Display Phone Number */}
              <VStack gap={2} width="100%">
                <HStack gap={2} vAlign="end" wrap="wrap" width="100%">
                  <TextInput
                    label="Admin Paired Phone Number (shown to users so they know which number to text)"
                    value={phoneInput}
                    onChange={val => {
                      setPhoneInput(val);
                      setPhoneDirty(true);
                    }}
                    placeholder="+92 300 1234567"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    label="Save Number"
                    icon={<Icon icon={Phone} size="sm" />}
                    isDisabled={busy || !phoneInput.trim()}
                    onClick={() => void callAdminAction("set_phone")}
                  />
                </HStack>
              </VStack>

              {/* Action Buttons */}
              <HStack gap={2} wrap="wrap" vAlign="center">
                {!isPaired ? (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      label={busy || isStarting ? "Starting Bridge…" : "Pair Google Messages (QR)"}
                      icon={<Icon icon={busy || isStarting ? LoaderCircle : QrCode} size="sm" />}
                      isDisabled={busy}
                      onClick={() => void callAdminAction("pair")}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      label="Open Pairing Window"
                      icon={<Icon icon={ExternalLink} size="sm" />}
                      isDisabled={busy}
                      onClick={() => void callAdminAction("open_window")}
                    />
                    {(isQrReady || isStarting) && (
                      <Button
                        variant="secondary"
                        size="sm"
                        label="Refresh QR"
                        icon={<Icon icon={RefreshCw} size="sm" />}
                        isDisabled={busy}
                        onClick={() => void callAdminAction("refresh_qr")}
                      />
                    )}
                  </>
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      label="Open Messages Window"
                      icon={<Icon icon={ExternalLink} size="sm" />}
                      isDisabled={busy}
                      onClick={() => void callAdminAction("open_window")}
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      label="Unpair & Disconnect"
                      icon={<Icon icon={Power} size="sm" />}
                      isDisabled={busy}
                      onClick={() => void callAdminAction("disconnect")}
                    />
                  </>
                )}
              </HStack>

              {/* Live QR Code Display when pairing */}
              {isQrReady && gmStatus?.qrDataUrl && (
                <Card padding={4}>
                  <VStack gap={3} hAlign="center" width="100%">
                    <Heading level={4}>Scan with Google Messages on Your Android Phone</Heading>
                    <Card padding={2}>
                      <img
                        src={gmStatus.qrDataUrl}
                        alt="Google Messages Web Device Pairing QR Code"
                        width={240}
                        height={240}
                      />
                    </Card>
                    <Text size="sm" color="secondary">
                      On your phone: open <strong>Google Messages</strong> → tap your <strong>Profile / Menu</strong> →{" "}
                      <strong>Device pairing</strong> → <strong>QR code scanner</strong> → scan this code.
                    </Text>
                  </VStack>
                </Card>
              )}

              {isStarting && !isQrReady && (
                <Banner
                  status="info"
                  title="Launching Google Messages for Web via Playwright… Fetching live QR code (if Google prompts for account sign-in, click 'Open Pairing Window')."
                />
              )}

              {isPaired && (
                <Banner
                  status="success"
                  title={`Google Messages Paired & Listening! Any user who texts "/login <their-key>" to ${gmStatus?.adminPhone || "your paired phone"} will authenticate into their own isolated Relief Assist session.`}
                />
              )}

              {/* Safety Guard for Personal Phone */}
              <HStack justify="between" vAlign="center" wrap="wrap" gap={2} width="100%">
                <HStack gap={2} vAlign="center">
                  <Icon icon={ShieldCheck} size="sm" />
                  <Text size="sm" color="secondary">
                    {gmStatus?.autoPromptUnknown
                      ? "Auto-prompt ON: unknown SMS senders receive a /login instruction."
                      : "Safe mode ON: only replies to unknown numbers if they text /login, /start, or /help (prevents replying to personal texts or OTPs)."}
                  </Text>
                </HStack>
                <Button
                  variant="secondary"
                  size="sm"
                  label={gmStatus?.autoPromptUnknown ? "Enable Safe Mode" : "Auto-Prompt Unknowns"}
                  isDisabled={busy}
                  onClick={() =>
                    void callAdminAction("toggle_auto_prompt", {
                      autoPromptUnknown: !gmStatus?.autoPromptUnknown,
                    })
                  }
                />
              </HStack>

              {/* Active SMS Users */}
              {gmStatus?.activeUsers && gmStatus.activeUsers.length > 0 && (
                <VStack gap={2} width="100%">
                  <Text size="sm" color="secondary">
                    <strong>Active SMS Sessions:</strong>
                  </Text>
                  <HStack gap={2} wrap="wrap">
                    {gmStatus.activeUsers.map(u => (
                      <Badge
                        key={u.userId}
                        label={`${u.name} (${u.role}) · ${u.linkedPhone}`}
                        variant="success"
                      />
                    ))}
                  </HStack>
                </VStack>
              )}

              {/* Admin Direct SMS Simulator */}
              <Card padding={3}>
                <VStack gap={2} width="100%">
                  <HStack gap={2} vAlign="center">
                    <Icon icon={Sparkles} size="sm" />
                    <Heading level={5}>Direct SMS Test Console (Admin)</Heading>
                  </HStack>
                  <Text size="sm" color="secondary">
                    Test the exact <code>/login &lt;key&gt;</code> and scoped SMS conversation flow from any phone number.
                  </Text>

                  {simLog.length > 0 && (
                    <VStack gap={2} width="100%">
                      {simLog.map((item, idx) => (
                        <Banner
                          key={idx}
                          status={item.sender === "sms" ? "info" : "success"}
                          title={`${item.sender === "sms" ? "Inbound SMS" : "SMS Reply"} (${item.time}): ${item.text}`}
                        />
                      ))}
                    </VStack>
                  )}

                  <HStack gap={2} wrap="wrap" vAlign="end" width="100%">
                    <TextInput
                      label="Sender Phone"
                      value={simPhone}
                      onChange={setSimPhone}
                      placeholder="+92 301 5551234"
                    />
                    <TextInput
                      label="SMS Message"
                      value={simText}
                      onChange={setSimText}
                      placeholder="Type /login <key> or an SMS question..."
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      label={simBusy ? "Sending…" : "Send SMS"}
                      icon={<Icon icon={Send} size="sm" />}
                      isDisabled={simBusy || !simText.trim() || !simPhone.trim()}
                      onClick={() => void handleSimulateSms()}
                    />
                  </HStack>
                </VStack>
              </Card>

              {/* Admin-Only Live SMS Messages Feed */}
              <Card padding={3}>
                <VStack gap={2} width="100%">
                  <HStack justify="between" vAlign="center" width="100%">
                    <HStack gap={2} vAlign="center">
                      <Icon icon={Inbox} size="sm" />
                      <Heading level={5}>Live Direct SMS Messages Feed ({smsFeed.length})</Heading>
                    </HStack>
                    <Button
                      variant="secondary"
                      size="sm"
                      label="Refresh"
                      icon={<Icon icon={RefreshCw} size="sm" />}
                      onClick={() => void fetchStatusAndToken(true)}
                    />
                  </HStack>

                  {smsFeed.length === 0 ? (
                    <Text size="sm" color="secondary">
                      No direct SMS messages recorded yet. Once paired, incoming /login and SMS chats will appear here in real time.
                    </Text>
                  ) : (
                    <VStack gap={2} width="100%">
                      {smsFeed.slice(0, 20).map(m => (
                        <Card key={m.id} padding={3}>
                          <VStack gap={1} width="100%">
                            <HStack justify="between" vAlign="center" wrap="wrap" gap={2} width="100%">
                              <HStack gap={2} vAlign="center">
                                <Badge
                                  label={m.direction === "inbound" ? `SMS From ${m.from}` : `SMS To ${m.to}`}
                                  variant={m.direction === "inbound" ? "info" : "success"}
                                />
                                {m.authenticatedUser && (
                                  <Badge
                                    label={`${m.authenticatedUser} (${m.authenticatedRole})`}
                                    variant="neutral"
                                  />
                                )}
                              </HStack>
                              <Text size="sm" color="secondary">
                                {new Date(m.timestamp).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  second: "2-digit",
                                })}
                              </Text>
                            </HStack>
                            <Text size="sm">{m.text}</Text>
                            {m.toolsUsed && m.toolsUsed.length > 0 && (
                              <HStack gap={1.5} wrap="wrap">
                                {m.toolsUsed.map(t => (
                                  <Badge key={t} label={`tool: ${t}`} variant="neutral" />
                                ))}
                              </HStack>
                            )}
                          </VStack>
                        </Card>
                      ))}
                    </VStack>
                  )}
                </VStack>
              </Card>
            </VStack>
          </Card>
        )}
      </VStack>
    </Card>
  );
}
