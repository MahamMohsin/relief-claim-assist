"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Briefcase,
  CheckCircle2,
  ExternalLink,
  FileText,
  IdCard,
  Receipt,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { api, HttpError } from "@/src/lib/client";
import { prepareDocumentImage } from "@/src/lib/compressImage";
import type { CitizenDocument, CitizenProfileData, CitizenRecord } from "@/src/lib/contracts";
import type { ViewContext } from "./MiniApps";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Selector } from "@astryxdesign/core/Selector";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { Token } from "@astryxdesign/core/Token";

type ProfileDocKind = "cnic" | "utility_bill" | "job_proof";

type StoredDocMeta = {
  document_id?: string;
  verified_status?: string;
  confidence?: number | null;
  model?: string;
  updated_at?: string;
  fields?: Record<string, string>;
};

const DOC_META: Record<
  ProfileDocKind,
  {
    label: string;
    short: string;
    description: string;
    icon: typeof IdCard;
    color: "blue" | "teal" | "green";
  }
> = {
  cnic: {
    label: "Synthetic CNIC",
    short: "Fake CNIC",
    description: "Extracts mock CNIC number, name, area, and expiry date.",
    icon: IdCard,
    color: "blue",
  },
  utility_bill: {
    label: "Utility bill",
    short: "Utility Bill",
    description: "Extracts provider, consumer ref, billing month, units, and address.",
    icon: Receipt,
    color: "teal",
  },
  job_proof: {
    label: "Job / income proof",
    short: "Job Proof",
    description: "Extracts occupation, employer, pay period, and monthly income.",
    icon: Briefcase,
    color: "green",
  },
};

const currency = (value: number) => "PKR " + new Intl.NumberFormat("en-PK").format(value);
const formatKey = (key: string) => key.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());
const pct = (value: number) => `${Math.round(value * 100)}%`;

function statusBadgeVariant(status: string): "success" | "warning" | "error" | "neutral" {
  if (["readable", "verified", "genuine"].includes(status)) return "success";
  if (["suspect", "tampered"].includes(status)) return "error";
  if (["unreadable", "incomplete"].includes(status)) return "warning";
  return "neutral";
}

export function CitizenProfileView({ ctx }: { ctx: ViewContext }) {
  const [data, setData] = useState<CitizenProfileData | null>(null);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [loading, setLoading] = useState(!ctx.offline);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [docType, setDocType] = useState<ProfileDocKind>("cnic");
  const [file, setFile] = useState<File | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [applyToCore, setApplyToCore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [latestDoc, setLatestDoc] = useState<CitizenDocument | null>(null);

  const loadProfile = useCallback(async (signal?: AbortSignal) => {
    if (ctx.offline || !ctx.citizen) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await api<CitizenProfileData>(
        "citizen_profile",
        { citizenId: ctx.citizen },
        signal,
      );
      if (signal?.aborted) return;
      setMigrationMissing(false);
      setData(res);
    } catch (err) {
      if (signal?.aborted) return;
      // Fallback to read-only NADRA record if the new SQL migration hasn't been applied yet
      const msg = err instanceof Error ? err.message : "Could not load citizen profile.";
      if (err instanceof HttpError && (err.status === 400 || err.status === 403 || err.status === 404)) {
        try {
          const fallback = await api<CitizenRecord>("nadra", { citizenId: ctx.citizen }, signal);
          if (!signal?.aborted && fallback) {
            setData({ citizen: fallback, documents: [] });
            setMigrationMissing(true);
            return;
          }
        } catch {
          // fall through to main error
        }
      }
      setError(msg);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [ctx.citizen, ctx.offline]);

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile, ctx.version]);

  if (!ctx.citizen) {
    return (
      <Card padding={6}>
        <VStack gap={3} hAlign="start">
          <Icon icon={UsersRound} size="lg" color="secondary" />
          <Heading level={3}>Choose a family first</Heading>
          <Text color="secondary">
            Family Switch verifies consent before viewing or updating a citizen&apos;s VLM profile.
          </Text>
          <Button variant="primary" label="Open Family Switch" onClick={() => ctx.go("family")} />
        </VStack>
      </Card>
    );
  }

  function handleFilePick(picked: File | File[] | null) {
    const next = Array.isArray(picked) ? picked[0] ?? null : picked;
    setFile(next);
    setNotice("");
    setError("");
    if (!next) {
      setImageData(null);
      return;
    }
    void prepareDocumentImage(next)
      .then(dataUrl => setImageData(dataUrl))
      .catch(err => {
        setError(err instanceof Error ? err.message : "Could not process that image file.");
        setFile(null);
        setImageData(null);
      });
  }

  async function runExtraction(useSample: boolean) {
    if (busy || ctx.offline) return;
    if (!useSample && !imageData) {
      setError("Upload a synthetic document image or click Try sample extraction.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    setLatestDoc(null);
    try {
      const res = await api<{ document: CitizenDocument; citizen: CitizenRecord }>(
        "citizen_doc_upload",
        {
          citizenId: ctx.citizen,
          docType,
          applyToCore,
          useSample,
          ...(imageData && !useSample ? { image: imageData } : {}),
        },
      );
      setLatestDoc(res.document);
      setData(prev => ({
        citizen: res.citizen,
        documents: [res.document, ...(prev?.documents ?? [])],
      }));
      setFile(null);
      setImageData(null);
      if (res.document.verified_status === "readable") {
        setNotice(`${DOC_META[docType].short} extracted and synced to your profile.`);
      } else if (res.document.verified_status === "unreadable") {
        setNotice("Document saved, but the image was too blurry to read. Try a clearer image.");
      }
      ctx.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "VLM extraction failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const citizen = data?.citizen;
  const documents = data?.documents ?? [];
  const meta = (citizen?.profile_metadata_json ?? {}) as Record<string, unknown>;
  const verifiedKinds = (["cnic", "utility_bill", "job_proof"] as ProfileDocKind[]).filter(
    kind => Boolean(meta[kind]) || documents.some(d => d.doc_type === kind && !d.tamper_flag),
  );

  return (
    <VStack gap={4} width="100%">
      {migrationMissing && (
        <Banner
          status="warning"
          title="Database migration needed to save VLM documents"
          description="Run supabase/migrations/20261122014000_citizen_profile_vlm.sql in Supabase to enable profile_metadata_json and citizen_documents storage. Showing your base citizen record below."
        />
      )}
      {error && <Banner status="error" title="Could not update profile" description={error} />}
      {notice && <Banner status="success" title={notice} />}

      {/* 1. Core Citizen Profile Summary */}
      <Card padding={5}>
        {loading && !citizen ? (
          <HStack gap={2} vAlign="center">
            <Spinner size="sm" />
            <Text color="secondary">Loading citizen profile…</Text>
          </HStack>
        ) : citizen ? (
          <VStack gap={4} width="100%">
            <HStack justify="between" vAlign="start" gap={3} wrap="wrap">
              <VStack gap={0.5}>
                <Heading level={2}>{citizen.full_name}</Heading>
                <Text type="supporting" color="secondary">
                  Mock CNIC: {citizen.cnic_mock} · {citizen.village_area} · {citizen.phone}
                </Text>
              </VStack>
            </HStack>

            <Grid columns={{ minWidth: 150, max: 4 }} gap={2} width="100%">
              <Card variant="muted" padding={3}>
                <VStack gap={0.5}>
                  <Text type="supporting" color="secondary">
                    Monthly income
                  </Text>
                  <Text type="large" weight="semibold" hasTabularNumbers>
                    {currency(citizen.monthly_income_mock)}
                  </Text>
                </VStack>
              </Card>
              <Card variant="muted" padding={3}>
                <VStack gap={0.5}>
                  <Text type="supporting" color="secondary">
                    Household size
                  </Text>
                  <Text type="large" weight="semibold" hasTabularNumbers>
                    {citizen.household_size} people
                  </Text>
                </VStack>
              </Card>
              <Card variant="muted" padding={3}>
                <VStack gap={0.5}>
                  <Text type="supporting" color="secondary">
                    Area / Colony
                  </Text>
                  <Text type="large" weight="semibold">
                    {citizen.village_area}
                  </Text>
                </VStack>
              </Card>
              <Card variant="muted" padding={3}>
                <VStack gap={0.5}>
                  <Text type="supporting" color="secondary">
                    Occupation
                  </Text>
                  <Text type="large" weight="semibold">
                    {typeof meta.occupation === "string" ? meta.occupation : "Not extracted yet"}
                  </Text>
                </VStack>
              </Card>
            </Grid>

            {/* Proof readiness checklist */}
            <HStack gap={2} wrap="wrap" vAlign="center">
              {(["cnic", "utility_bill", "job_proof"] as ProfileDocKind[]).map(kind => {
                const done = verifiedKinds.includes(kind);
                return (
                  <Token
                    key={kind}
                    label={DOC_META[kind].short}
                    size="sm"
                    color={done ? "green" : "gray"}
                    icon={<Icon icon={done ? CheckCircle2 : DOC_META[kind].icon} size="sm" />}
                    onClick={() => setDocType(kind)}
                  />
                );
              })}
            </HStack>
          </VStack>
        ) : (
          <EmptyState
            isCompact
            title="Profile unavailable"
            description="Reconnect to load your citizen profile."
          />
        )}
      </Card>

      {/* 2. VLM Document Upload & Extraction */}
      <Card padding={5}>
        <VStack gap={3} width="100%">
          <Selector
            label="Document category"
            value={docType}
            onChange={val => setDocType((val ?? "cnic") as ProfileDocKind)}
            options={[
              { value: "cnic", label: "Fake CNIC (identity card)" },
              { value: "utility_bill", label: "Utility bill (electricity / gas / water)" },
              { value: "job_proof", label: "Job proof / salary slip" },
            ]}
          />

          <Text type="supporting" color="secondary">
            {DOC_META[docType].description}
          </Text>

          <FileInput
            label={`Upload synthetic ${DOC_META[docType].short} image (PNG, JPEG, or WebP)`}
            value={file}
            onChange={handleFilePick}
            accept="image/png,image/jpeg,image/webp"
            mode="dropzone"
            isOptional
          />

          <HStack gap={2} wrap="wrap" vAlign="center" justify="between">
            <HStack gap={2} wrap="wrap">
              <Button
                variant="primary"
                label={busy ? "Extracting metadata…" : "Extract & update profile"}
                icon={<Icon icon={Sparkles} size="sm" />}
                isLoading={busy}
                isDisabled={busy || ctx.offline || !imageData || migrationMissing}
                onClick={() => void runExtraction(false)}
              />
              <Button
                variant="secondary"
                label={`Try ${DOC_META[docType].short} sample`}
                isDisabled={busy || ctx.offline || migrationMissing}
                onClick={() => void runExtraction(true)}
              />
            </HStack>

            <ToggleButton
              label="Sync income & area to profile"
              isPressed={applyToCore}
              onPressedChange={setApplyToCore}
              size="sm"
            />
          </HStack>

          {latestDoc && (
            <Card variant="muted" padding={3}>
              <VStack gap={2}>
                <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
                  <Text weight="semibold">
                    Latest extraction · {DOC_META[docType].label}
                  </Text>
                  <HStack gap={1.5}>
                    <Badge
                      label={formatKey(latestDoc.verified_status)}
                      variant={statusBadgeVariant(latestDoc.verified_status)}
                    />
                    {latestDoc.confidence !== null && (
                      <Token label={pct(latestDoc.confidence)} size="sm" color="blue" />
                    )}
                  </HStack>
                </HStack>
                {latestDoc.extracted_json.summary && (
                  <Text type="supporting" color="secondary">
                    {latestDoc.extracted_json.summary}
                  </Text>
                )}
                {latestDoc.extracted_json.fields &&
                  Object.keys(latestDoc.extracted_json.fields).length > 0 && (
                    <HStack gap={1.5} wrap="wrap">
                      {Object.entries(latestDoc.extracted_json.fields).map(([k, v]) => (
                        <Token key={k} label={`${formatKey(k)}: ${v}`} size="sm" color="gray" />
                      ))}
                    </HStack>
                  )}
              </VStack>
            </Card>
          )}
        </VStack>
      </Card>

      {/* 3. VLM-Maintained Metadata Breakdown */}
      <Card padding={5}>
        <VStack gap={3} width="100%">
          <VStack gap={0.5}>
            <Heading level={3}>VLM-maintained profile metadata</Heading>
            <Text type="supporting" color="secondary">
              Structured fields extracted across your uploaded proofs.
            </Text>
          </VStack>

          <Grid columns={{ minWidth: 210, max: 3 }} gap={3} width="100%">
            {(["cnic", "utility_bill", "job_proof"] as ProfileDocKind[]).map(kind => {
              const info = DOC_META[kind];
              const stored = meta[kind] as StoredDocMeta | undefined;
              const entries = Object.entries(stored?.fields ?? {}).filter(([, v]) => String(v).trim().length > 0);
              return (
                <Card key={kind} variant="muted" padding={3}>
                  <VStack gap={2}>
                    <HStack justify="between" vAlign="center" gap={1.5}>
                      <HStack gap={1.5} vAlign="center">
                        <Icon icon={info.icon} size="sm" color="secondary" />
                        <Text weight="semibold">{info.short}</Text>
                      </HStack>
                      <Badge
                        label={stored?.verified_status ? formatKey(stored.verified_status) : "Pending"}
                        variant={stored?.verified_status ? statusBadgeVariant(stored.verified_status) : "neutral"}
                      />
                    </HStack>

                    {entries.length > 0 ? (
                      <VStack gap={1}>
                        {entries.map(([k, v]) => (
                          <HStack key={k} justify="between" gap={2}>
                            <Text type="supporting" color="secondary">
                              {formatKey(k)}
                            </Text>
                            <Text type="supporting" weight="medium">
                              {v}
                            </Text>
                          </HStack>
                        ))}
                      </VStack>
                    ) : (
                      <Text type="supporting" color="secondary">
                        Upload a {info.short.toLowerCase()} above to populate these fields.
                      </Text>
                    )}
                  </VStack>
                </Card>
              );
            })}
          </Grid>
        </VStack>
      </Card>

      {/* 4. Uploaded Document History */}
      <Card padding={5}>
        <VStack gap={3} width="100%">
          <HStack justify="between" vAlign="center">
            <Heading level={3}>Uploaded profile documents</Heading>
            <Badge label={`${documents.length}`} variant="neutral" />
          </HStack>

          {documents.length === 0 ? (
            <EmptyState
              isCompact
              title="No profile documents yet"
              description="Upload a fake CNIC, utility bill, or job proof above to extract and store metadata."
            />
          ) : (
            <VStack gap={2} width="100%">
              {documents.map(doc => {
                const kindInfo =
                  doc.doc_type in DOC_META
                    ? DOC_META[doc.doc_type as ProfileDocKind]
                    : null;
                const fields = Object.fromEntries(
                  Object.entries(doc.extracted_json?.fields ?? {}).filter(([, v]) => String(v).trim().length > 0),
                );
                return (
                  <Card key={doc.id} variant="muted" padding={3}>
                    <Collapsible
                      defaultIsOpen={false}
                      trigger={
                        <HStack gap={2} vAlign="center" wrap="wrap">
                          <Token
                            label={kindInfo?.short ?? formatKey(doc.doc_type)}
                            size="sm"
                            color={kindInfo?.color ?? "gray"}
                          />
                          <Badge
                            label={formatKey(doc.verified_status)}
                            variant={statusBadgeVariant(doc.verified_status)}
                          />
                          <Text type="supporting" color="secondary">
                            {doc.model_version}
                            {doc.confidence !== null ? ` · ${pct(doc.confidence)}` : ""}
                            {" · "}
                            {new Date(doc.created_at).toLocaleString()}
                          </Text>
                        </HStack>
                      }
                    >
                      <VStack gap={2} paddingBlockStart={2}>
                        {doc.extracted_json?.summary && (
                          <Text>{doc.extracted_json.summary}</Text>
                        )}
                        {doc.tamper_reason && (
                          <Banner status="error" title="Tamper alert" description={doc.tamper_reason} />
                        )}
                        {Object.keys(fields).length > 0 && (
                          <HStack gap={1.5} wrap="wrap">
                            {Object.entries(fields).map(([k, v]) => (
                              <Token key={k} label={`${formatKey(k)}: ${v}`} size="sm" color="gray" />
                            ))}
                          </HStack>
                        )}
                        {doc.file_url && (
                          <HStack>
                            <Button
                              variant="ghost"
                              size="sm"
                              label="Open synthetic image"
                              href={doc.file_url}
                              target="_blank"
                              rel="noreferrer"
                              endContent={<Icon icon={ExternalLink} size="sm" />}
                            />
                          </HStack>
                        )}
                      </VStack>
                    </Collapsible>
                  </Card>
                );
              })}
            </VStack>
          )}
        </VStack>
      </Card>
    </VStack>
  );
}
