"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SLOW_HINT_TEXT, useSlowHint } from "@/src/lib/useSlowHint";
import {
  Briefcase,
  Expand,
  IdCard,
  Receipt,
  RefreshCw,
  Sparkles,
  Upload,
  UsersRound,
} from "lucide-react";
import { api, HttpError } from "@/src/lib/client";
import { prepareDocumentImage } from "@/src/lib/compressImage";
import type { CitizenDocument, CitizenProfileData, CitizenRecord } from "@/src/lib/contracts";
import type { ViewContext } from "./MiniApps";
import { AspectRatio } from "@astryxdesign/core/AspectRatio";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { FileInput } from "@astryxdesign/core/FileInput";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Lightbox } from "@astryxdesign/core/Lightbox";
import { Overlay } from "@astryxdesign/core/Overlay";
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

const DOC_ORDER: ProfileDocKind[] = ["cnic", "utility_bill", "job_proof"];

const DOC_META: Record<
  ProfileDocKind,
  {
    short: string;
    optionLabel: string;
    icon: typeof IdCard;
    highlightKeys: string[];
  }
> = {
  cnic: {
    short: "Fake CNIC",
    optionLabel: "Fake CNIC (identity card)",
    icon: IdCard,
    highlightKeys: ["cnic_number", "holder_name", "address_area", "expiry_date"],
  },
  utility_bill: {
    short: "Utility Bill",
    optionLabel: "Utility bill (electricity / gas / water)",
    icon: Receipt,
    highlightKeys: ["provider", "bill_amount_pkr", "billing_month", "address_area"],
  },
  job_proof: {
    short: "Job Proof",
    optionLabel: "Job proof / salary slip",
    icon: Briefcase,
    highlightKeys: ["monthly_income_pkr", "demo_amount", "occupation", "employer", "pay_period", "month"],
  },
};

const currency = (value: number) => "PKR " + new Intl.NumberFormat("en-PK").format(value);
const formatKey = (key: string) => key.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());

function statusBadgeVariant(status?: string): "success" | "warning" | "error" | "neutral" {
  if (!status) return "neutral";
  if (["readable", "verified", "genuine"].includes(status)) return "success";
  if (["suspect", "tampered"].includes(status)) return "error";
  if (["unreadable", "incomplete"].includes(status)) return "warning";
  return "neutral";
}

function pickTopFields(kind: ProfileDocKind, fields?: Record<string, string>): [string, string][] {
  if (!fields) return [];
  const clean = Object.entries(fields).filter(([, v]) => String(v).trim().length > 0);
  if (clean.length === 0) return [];
  const preferred = DOC_META[kind].highlightKeys;
  const prioritized = preferred
    .map(key => clean.find(([k]) => k === key))
    .filter((entry): entry is [string, string] => Boolean(entry));
  const rest = clean.filter(([k]) => !preferred.includes(k));
  return [...prioritized, ...rest].slice(0, 3);
}

export function CitizenProfileView({ ctx }: { ctx: ViewContext }) {
  const [data, setData] = useState<CitizenProfileData | null>(null);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [loading, setLoading] = useState(!ctx.offline);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [docType, setDocType] = useState<ProfileDocKind>("cnic");
  const [file, setFile] = useState<File | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [applyToCore, setApplyToCore] = useState(true);
  const [busy, setBusy] = useState(false);
  const slow = useSlowHint(busy);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

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

  const citizen = data?.citizen;
  const documents = useMemo(() => data?.documents ?? [], [data?.documents]);
  const meta = useMemo(
    () => (citizen?.profile_metadata_json ?? {}) as Record<string, unknown>,
    [citizen?.profile_metadata_json],
  );

  // All uploaded documents that carry an actual image, newest first
  const photoDocs = useMemo(
    () => documents.filter(d => Boolean(d.file_url)),
    [documents],
  );

  // Latest uploaded photo per primary category (CNIC, Utility Bill, Job Proof)
  const heroPhotoByKind = useMemo(() => {
    const map: Partial<Record<ProfileDocKind, CitizenDocument>> = {};
    for (const kind of DOC_ORDER) {
      map[kind] = photoDocs.find(d => d.doc_type === kind);
    }
    return map;
  }, [photoDocs]);

  const heroPhotoIds = useMemo(
    () => new Set(Object.values(heroPhotoByKind).filter(Boolean).map(d => d!.id)),
    [heroPhotoByKind],
  );

  const extraPhotoDocs = useMemo(
    () => photoDocs.filter(d => !heroPhotoIds.has(d.id)),
    [photoDocs, heroPhotoIds],
  );

  const lightboxMedia = useMemo(
    () =>
      photoDocs.map(doc => {
        const label =
          doc.doc_type in DOC_META
            ? DOC_META[doc.doc_type as ProfileDocKind].short
            : formatKey(doc.doc_type);
        const fieldPairs = Object.entries(doc.extracted_json?.fields ?? {}).filter(
          ([, v]) => String(v).trim().length > 0,
        );
        return {
          src: doc.file_url!,
          alt: `${label} document`,
          caption: (
            <VStack gap={1.5}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Text weight="semibold">{label}</Text>
                <Badge
                  label={formatKey(doc.verified_status)}
                  variant={statusBadgeVariant(doc.verified_status)}
                />
              </HStack>
              {fieldPairs.length > 0 && (
                <HStack gap={1} wrap="wrap">
                  {fieldPairs.map(([k, v]) => (
                    <Token key={k} label={`${formatKey(k)}: ${v}`} size="sm" color="gray" />
                  ))}
                </HStack>
              )}
            </VStack>
          ),
        };
      }),
    [photoDocs],
  );

  if (!ctx.citizen) {
    return (
      <Card padding={6}>
        <VStack gap={3} hAlign="start">
          <Icon icon={UsersRound} size="lg" color="secondary" />
          <Heading level={3}>Choose a family first</Heading>
          <Text color="secondary">
            Family Switch verifies consent before viewing or updating a citizen&apos;s profile.
          </Text>
          <Button variant="primary" label="Open Family Switch" onClick={() => ctx.go("family")} />
        </VStack>
      </Card>
    );
  }

  function openUploadModal(kind: ProfileDocKind) {
    setDocType(kind);
    setFile(null);
    setImageData(null);
    setError("");
    setUploadOpen(true);
  }

  function openLightboxFor(docId: string) {
    const idx = photoDocs.findIndex(d => d.id === docId);
    if (idx >= 0) {
      setLightboxIndex(idx);
      setLightboxOpen(true);
    }
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

  async function runExtraction(useSample: boolean, targetKind?: ProfileDocKind) {
    const kind = targetKind ?? docType;
    if (busy || ctx.offline) return;
    if (!useSample && !imageData) {
      setError("Choose a document image or use a sample.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await api<{ document: CitizenDocument; citizen: CitizenRecord }>(
        "citizen_doc_upload",
        {
          citizenId: ctx.citizen,
          docType: kind,
          applyToCore,
          useSample,
          ...(imageData && !useSample ? { image: imageData } : {}),
        },
      );
      setData(prev => ({
        citizen: res.citizen,
        documents: [res.document, ...(prev?.documents ?? [])],
      }));
      setFile(null);
      setImageData(null);
      setUploadOpen(false);
      setNotice(`${DOC_META[kind].short} saved to profile.`);
      ctx.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not extract document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <VStack gap={4} width="100%">
      {migrationMissing && (
        <Banner
          status="warning"
          title="Database migration required"
          description="Run supabase/migrations/20261122014000_citizen_profile_vlm.sql to save profile photos."
        />
      )}
      {error && !uploadOpen && <Banner status="error" title={error} />}
      {notice && <Banner status="success" title={notice} />}

      {/* 1. Compact Identity Bar */}
      {loading && !citizen ? (
        <HStack gap={2} vAlign="center">
          <Spinner size="sm" />
          <Text color="secondary">Loading profile…</Text>
        </HStack>
      ) : citizen ? (
        <HStack justify="between" vAlign="center" gap={3} wrap="wrap" width="100%">
          <HStack gap={3} vAlign="center">
            <Avatar name={citizen.full_name} size="lg" />
            <VStack gap={0.5}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Heading level={3}>{citizen.full_name}</Heading>
                {typeof meta.occupation === "string" && (
                  <Token label={meta.occupation} size="sm" color="green" />
                )}
              </HStack>
              <Text type="supporting" color="secondary" hasTabularNumbers>
                {citizen.cnic_mock} · {citizen.village_area} · {currency(citizen.monthly_income_mock)}/mo · {citizen.household_size} people
              </Text>
            </VStack>
          </HStack>

          <Button
            variant="primary"
            size="sm"
            label="Upload photo"
            icon={<Icon icon={Upload} size="sm" />}
            isDisabled={ctx.offline || migrationMissing}
            onClick={() => openUploadModal("cnic")}
          />
        </HStack>
      ) : (
        <EmptyState
          isCompact
          title="Profile unavailable"
          description="Reconnect to load your profile."
        />
      )}

      {/* 2. Hero Visual Proofs — CNIC, Utility Bill, Job Proof Images First */}
      <Grid columns={{ minWidth: 220, max: 3 }} gap={3} width="100%">
        {DOC_ORDER.map(kind => {
          const info = DOC_META[kind];
          const photoDoc = heroPhotoByKind[kind];
          const stored = meta[kind] as StoredDocMeta | undefined;
          const activeStatus = photoDoc?.verified_status ?? stored?.verified_status;
          const topFields = pickTopFields(kind, photoDoc?.extracted_json?.fields ?? stored?.fields);

          return (
            <Card key={kind} padding={0}>
              <VStack gap={0} width="100%">
                {/* Primary Image Surface */}
                {photoDoc?.file_url ? (
                  <Overlay
                    showOn="always"
                    position="bottom"
                    scrim="dark"
                    align="end"
                    content={
                      <HStack justify="between" vAlign="center" width="100%" gap={2}>
                        <Button
                          variant="secondary"
                          size="sm"
                          label="Zoom"
                          icon={<Icon icon={Expand} size="sm" />}
                          onClick={() => openLightboxFor(photoDoc.id)}
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          label="Replace"
                          icon={<Icon icon={RefreshCw} size="sm" />}
                          isDisabled={ctx.offline || migrationMissing}
                          onClick={() => openUploadModal(kind)}
                        />
                      </HStack>
                    }
                  >
                    <AspectRatio ratio={16 / 10} fit="cover">
                      <img src={photoDoc.file_url} alt={`${info.short} upload`} />
                    </AspectRatio>
                  </Overlay>
                ) : (
                  <AspectRatio ratio={16 / 10} fit="center">
                    <Card variant="muted" padding={0} width="100%" height="100%">
                      <Center width="100%" height="100%" padding={3}>
                        <VStack gap={2} hAlign="center">
                          <Icon icon={info.icon} size="lg" color="secondary" />
                          <HStack gap={1.5} wrap="wrap" hAlign="center">
                            <Button
                              variant="primary"
                              size="sm"
                              label={`Add ${info.short}`}
                              icon={<Icon icon={Upload} size="sm" />}
                              isDisabled={ctx.offline || migrationMissing || busy}
                              onClick={() => openUploadModal(kind)}
                            />
                            {!stored && (
                              <Button
                                variant="ghost"
                                size="sm"
                                label="Sample"
                                isDisabled={ctx.offline || migrationMissing || busy}
                                onClick={() => void runExtraction(true, kind)}
                              />
                            )}
                          </HStack>
                        </VStack>
                      </Center>
                    </Card>
                  </AspectRatio>
                )}

                {/* Compact Image Caption & Key Extracted Pills */}
                <VStack gap={1.5} padding={3} width="100%">
                  <HStack justify="between" vAlign="center" gap={2} width="100%">
                    <HStack gap={1.5} vAlign="center">
                      <Icon icon={info.icon} size="sm" color="secondary" />
                      <Text weight="semibold">{info.short}</Text>
                    </HStack>
                    <Badge
                      label={activeStatus ? formatKey(activeStatus) : "Empty"}
                      variant={statusBadgeVariant(activeStatus)}
                    />
                  </HStack>

                  {topFields.length > 0 && (
                    <HStack gap={1} wrap="wrap">
                      {topFields.map(([k, v]) => (
                        <Token key={k} label={v} size="sm" color="gray" />
                      ))}
                    </HStack>
                  )}
                </VStack>
              </VStack>
            </Card>
          );
        })}
      </Grid>

      {/* 3. Additional Uploaded Photos Strip */}
      {extraPhotoDocs.length > 0 && (
        <VStack gap={2} width="100%">
          <HStack gap={2} vAlign="center">
            <Heading level={4}>Previous uploads</Heading>
            <Badge label={`${extraPhotoDocs.length}`} variant="neutral" />
          </HStack>
          <Grid columns={{ minWidth: 140, max: 5 }} gap={2} width="100%">
            {extraPhotoDocs.map(doc => {
              const label =
                doc.doc_type in DOC_META
                  ? DOC_META[doc.doc_type as ProfileDocKind].short
                  : formatKey(doc.doc_type);
              return (
                <Card key={doc.id} padding={0}>
                  <VStack gap={0} width="100%">
                    <Overlay
                      showOn="hover-or-focus"
                      position="fill"
                      scrim="dark"
                      align="center"
                      content={
                        <Button
                          variant="secondary"
                          size="sm"
                          label="View"
                          icon={<Icon icon={Expand} size="sm" />}
                          onClick={() => openLightboxFor(doc.id)}
                        />
                      }
                    >
                      <AspectRatio ratio={4 / 3} fit="cover">
                        <img src={doc.file_url!} alt={label} />
                      </AspectRatio>
                    </Overlay>
                    <HStack justify="between" vAlign="center" padding={2} gap={1}>
                      <Text type="supporting" weight="medium">
                        {label}
                      </Text>
                      <Badge
                        label={formatKey(doc.verified_status)}
                        variant={statusBadgeVariant(doc.verified_status)}
                      />
                    </HStack>
                  </VStack>
                </Card>
              );
            })}
          </Grid>
        </VStack>
      )}

      {/* 4. Focused Upload & Live Preview Dialog */}
      <Dialog
        isOpen={uploadOpen}
        onOpenChange={open => {
          if (!busy) setUploadOpen(open);
        }}
        width={480}
        maxHeight="90dvh"
        padding={4}
        purpose="form"
      >
        <VStack gap={3} width="100%">
          <DialogHeader
            title={`Upload ${DOC_META[docType].short}`}
            onOpenChange={open => {
              if (!busy) setUploadOpen(open);
            }}
          />

          {error && <Banner status="error" title={error} />}

          <Selector
            label="Document type"
            value={docType}
            onChange={val => setDocType((val ?? "cnic") as ProfileDocKind)}
            options={DOC_ORDER.map(kind => ({
              value: kind,
              label: DOC_META[kind].optionLabel,
            }))}
          />

          {imageData && (
            <Card variant="muted" padding={0}>
              <AspectRatio ratio={2.2} fit="contain">
                <img src={imageData} alt="Selected document preview" />
              </AspectRatio>
            </Card>
          )}

          <FileInput
            label="Document photo (PNG, JPEG, or WebP)"
            value={file}
            onChange={handleFilePick}
            accept="image/png,image/jpeg,image/webp,.jfif"
            mode={imageData ? "input" : "dropzone"}
          />

          <HStack justify="between" vAlign="center" gap={2} wrap="wrap" width="100%">
            <ToggleButton
              label="Sync to profile"
              isPressed={applyToCore}
              onPressedChange={setApplyToCore}
              size="sm"
            />
            <HStack gap={2}>
              <Button
                variant="secondary"
                label="Use sample"
                isDisabled={busy || ctx.offline || migrationMissing}
                onClick={() => void runExtraction(true)}
              />
              <Button
                variant="primary"
                label={busy ? (slow ? SLOW_HINT_TEXT : "Extracting…") : "Extract & save"}
                icon={<Icon icon={Sparkles} size="sm" />}
                isLoading={busy}
                isDisabled={busy || ctx.offline || !imageData || migrationMissing}
                onClick={() => void runExtraction(false)}
              />
            </HStack>
          </HStack>
        </VStack>
      </Dialog>

      {/* 5. Fullscreen Zoomable Image Lightbox */}
      {lightboxMedia.length > 0 && (
        <Lightbox
          isOpen={lightboxOpen}
          onOpenChange={setLightboxOpen}
          media={lightboxMedia}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          hasZoom
        />
      )}
    </VStack>
  );
}
