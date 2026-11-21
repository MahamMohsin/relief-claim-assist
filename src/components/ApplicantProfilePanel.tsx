"use client";

import { useEffect, useMemo, useState } from "react";
import { Briefcase, Expand, IdCard, Receipt } from "lucide-react";
import { api, HttpError } from "@/src/lib/client";
import type { CitizenDocument, CitizenProfileData } from "@/src/lib/contracts";
import { AspectRatio } from "@astryxdesign/core/AspectRatio";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Center } from "@astryxdesign/core/Center";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Lightbox } from "@astryxdesign/core/Lightbox";
import { Overlay } from "@astryxdesign/core/Overlay";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading, Text } from "@astryxdesign/core/Text";
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

const DOC_META: Record<ProfileDocKind, { short: string; icon: typeof IdCard }> = {
  cnic: { short: "Fake CNIC", icon: IdCard },
  utility_bill: { short: "Utility Bill", icon: Receipt },
  job_proof: { short: "Job Proof", icon: Briefcase },
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

export function ApplicantProfilePanel({
  citizenId,
  claimIncome,
  claimHousehold,
  offline,
  version,
}: {
  citizenId: string;
  claimIncome?: number;
  claimHousehold?: number;
  offline: boolean;
  version: number;
}) {
  const [data, setData] = useState<CitizenProfileData | null>(null);
  const [loading, setLoading] = useState(!offline);
  const [error, setError] = useState("");
  const [migrationHint, setMigrationHint] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  useEffect(() => {
    if (offline || !citizenId) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setMigrationHint(false);

    void api<CitizenProfileData>("citizen_profile", { citizenId }, controller.signal)
      .then(res => {
        if (!controller.signal.aborted) setData(res);
      })
      .catch(err => {
        if (controller.signal.aborted) return;
        if (err instanceof HttpError && err.status === 403) {
          setMigrationHint(true);
        }
        setError(err instanceof Error ? err.message : "Could not load applicant profile.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [citizenId, offline, version]);

  const citizen = data?.citizen;
  const documents = useMemo(() => data?.documents ?? [], [data?.documents]);
  const meta = useMemo(
    () => (citizen?.profile_metadata_json ?? {}) as Record<string, unknown>,
    [citizen?.profile_metadata_json],
  );

  const photoDocs = useMemo(
    () => documents.filter(d => Boolean(d.file_url)),
    [documents],
  );

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

  function openLightboxFor(docId: string) {
    const idx = photoDocs.findIndex(d => d.id === docId);
    if (idx >= 0) {
      setLightboxIndex(idx);
      setLightboxOpen(true);
    }
  }

  if (loading && !citizen) {
    return (
      <Card padding={4}>
        <HStack gap={2} vAlign="center">
          <Spinner size="sm" />
          <Text color="secondary">Loading applicant full profile…</Text>
        </HStack>
      </Card>
    );
  }

  if (error) {
    return (
      <Banner
        status="warning"
        title={migrationHint ? "Run latest SQL migration for officer profile access" : "Applicant profile unavailable"}
        description={
          migrationHint
            ? "Apply supabase/migrations/20261122024500_officer_citizen_profile.sql in Supabase so officers can view full citizen profiles and uploaded proof photos."
            : error
        }
      />
    );
  }

  if (!citizen) return null;

  const incomeDiffers =
    typeof claimIncome === "number" && claimIncome !== citizen.monthly_income_mock;
  const householdDiffers =
    typeof claimHousehold === "number" && claimHousehold !== citizen.household_size;

  const occupation = typeof meta.occupation === "string" ? meta.occupation : null;
  const employer = typeof meta.employer === "string" ? meta.employer : null;
  const utilityProvider = typeof meta.utility_provider === "string" ? meta.utility_provider : null;
  const cnicExpiry = typeof meta.cnic_expiry === "string" ? meta.cnic_expiry : null;

  return (
    <Card padding={4}>
      <VStack gap={4} width="100%">
        {/* Header: Applicant Full Identity */}
        <HStack justify="between" vAlign="start" gap={3} wrap="wrap" width="100%">
          <HStack gap={3} vAlign="center">
            <Avatar name={citizen.full_name} size="lg" />
            <VStack gap={0.5}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Heading level={3}>Applicant profile</Heading>
                <Badge label={`${photoDocs.length} photo${photoDocs.length === 1 ? "" : "s"}`} variant="neutral" />
                {occupation && <Token label={occupation} size="sm" color="green" />}
              </HStack>
            </VStack>
          </HStack>
        </HStack>

        {/* Core Profile & Cross-Check Facts */}
        <Grid columns={{ minWidth: 140, max: 4 }} gap={2} width="100%">
          <Card variant="muted" padding={3}>
            <VStack gap={0.5}>
              <Text type="supporting" color="secondary">Area / Colony</Text>
              <Text weight="semibold">{citizen.village_area}</Text>
            </VStack>
          </Card>
          <Card variant="muted" padding={3}>
            <VStack gap={0.5}>
              <HStack justify="between" vAlign="center" gap={1}>
                <Text type="supporting" color="secondary">Profile income</Text>
                {incomeDiffers && <Badge label="Differs" variant="warning" />}
              </HStack>
              <Text weight="semibold" hasTabularNumbers>
                {currency(citizen.monthly_income_mock)}/mo
              </Text>
              {incomeDiffers && (
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  Claim declared: {currency(claimIncome!)}
                </Text>
              )}
            </VStack>
          </Card>
          <Card variant="muted" padding={3}>
            <VStack gap={0.5}>
              <HStack justify="between" vAlign="center" gap={1}>
                <Text type="supporting" color="secondary">Household</Text>
                {householdDiffers && <Badge label="Differs" variant="warning" />}
              </HStack>
              <Text weight="semibold" hasTabularNumbers>
                {citizen.household_size} people
              </Text>
              {householdDiffers && (
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  Claim declared: {claimHousehold}
                </Text>
              )}
            </VStack>
          </Card>
          <Card variant="muted" padding={3}>
            <VStack gap={0.5}>
              <Text type="supporting" color="secondary">VLM summary</Text>
              <Text weight="semibold">
                {employer ?? utilityProvider ?? (cnicExpiry ? `CNIC exp ${cnicExpiry}` : "Verified on file")}
              </Text>
            </VStack>
          </Card>
        </Grid>

        {/* Image-First Profile Proofs (CNIC, Utility Bill, Job Proof) */}
        <Grid columns={{ minWidth: 200, max: 3 }} gap={3} width="100%">
          {DOC_ORDER.map(kind => {
            const info = DOC_META[kind];
            const photoDoc = heroPhotoByKind[kind];
            const stored = meta[kind] as StoredDocMeta | undefined;
            const activeStatus = photoDoc?.verified_status ?? stored?.verified_status;
            const fields = Object.entries(
              photoDoc?.extracted_json?.fields ?? stored?.fields ?? {},
            ).filter(([, v]) => String(v).trim().length > 0);

            return (
              <Card key={kind} padding={0}>
                <VStack gap={0} width="100%">
                  {photoDoc?.file_url ? (
                    <Overlay
                      showOn="always"
                      position="bottom"
                      scrim="dark"
                      align="end"
                      content={
                        <HStack justify="end" width="100%">
                          <Button
                            variant="secondary"
                            size="sm"
                            label="Zoom"
                            icon={<Icon icon={Expand} size="sm" />}
                            onClick={() => openLightboxFor(photoDoc.id)}
                          />
                        </HStack>
                      }
                    >
                      <AspectRatio ratio={16 / 10} fit="cover">
                        <img src={photoDoc.file_url} alt={`${info.short} on file`} />
                      </AspectRatio>
                    </Overlay>
                  ) : (
                    <AspectRatio ratio={16 / 10} fit="center">
                      <Card variant="muted" padding={0} width="100%" height="100%">
                        <Center width="100%" height="100%" padding={3}>
                          <VStack gap={1} hAlign="center">
                            <Icon icon={info.icon} size="lg" color="secondary" />
                            <Text type="supporting" color="secondary">No photo on file</Text>
                          </VStack>
                        </Center>
                      </Card>
                    </AspectRatio>
                  )}

                  <VStack gap={1.5} padding={3} width="100%">
                    <HStack justify="between" vAlign="center" gap={2} width="100%">
                      <HStack gap={1.5} vAlign="center">
                        <Icon icon={info.icon} size="sm" color="secondary" />
                        <Text weight="semibold">{info.short}</Text>
                      </HStack>
                      <Badge
                        label={activeStatus ? formatKey(activeStatus) : "Missing"}
                        variant={statusBadgeVariant(activeStatus)}
                      />
                    </HStack>

                    {fields.length > 0 && (
                      <VStack gap={0.5} width="100%">
                        {fields.map(([k, v]) => (
                          <HStack key={k} justify="between" gap={2} width="100%">
                            <Text type="supporting" color="secondary">{formatKey(k)}</Text>
                            <Text type="supporting" weight="medium">{v}</Text>
                          </HStack>
                        ))}
                      </VStack>
                    )}
                  </VStack>
                </VStack>
              </Card>
            );
          })}
        </Grid>

        {/* Additional Uploaded Photos */}
        {extraPhotoDocs.length > 0 && (
          <VStack gap={2} width="100%">
            <HStack gap={2} vAlign="center">
              <Text weight="semibold">Additional profile photos</Text>
              <Badge label={`${extraPhotoDocs.length}`} variant="neutral" />
            </HStack>
            <Grid columns={{ minWidth: 120, max: 5 }} gap={2} width="100%">
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
                      <HStack justify="between" vAlign="center" padding={1.5} gap={1}>
                        <Text type="supporting" weight="medium">{label}</Text>
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
    </Card>
  );
}
