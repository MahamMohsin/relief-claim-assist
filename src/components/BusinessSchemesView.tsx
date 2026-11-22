"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, CheckCircle2, Sparkles, Store } from "lucide-react";
import {
  BUSINESS_SCHEMES,
  matchBusinessSchemes,
  type BusinessQueryProfile,
  type BusinessScheme,
} from "@/src/lib/businessSchemes";
import type { ViewContext } from "./MiniApps";
import { cuaEngine } from "./os/cuaEngine";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Selector } from "@astryxdesign/core/Selector";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { ToggleButton } from "@astryxdesign/core/ToggleButton";
import { Token } from "@astryxdesign/core/Token";

const pkr = (value: number) => "PKR " + new Intl.NumberFormat("en-PK").format(value);

export function BusinessSchemesView({ ctx }: { ctx: ViewContext }) {
  const [sizeTab, setSizeTab] = useState<"all" | "small" | "large">("all");
  const [query, setQuery] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [monthlyRevenue, setMonthlyRevenue] = useState<number | null>(null);
  const [employees, setEmployees] = useState<number | null>(null);
  const [floodAffected, setFloodAffected] = useState(false);
  const [hasRaast, setHasRaast] = useState(false);
  const [needsGrantOnly, setNeedsGrantOnly] = useState(false);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const [applyScheme, setApplyScheme] = useState<BusinessScheme | null>(null);
  const [appliedIds, setAppliedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");

  const profile: BusinessQueryProfile = useMemo(
    () => ({
      size: sizeTab,
      businessType: businessType.trim() || undefined,
      monthlyRevenuePkr: monthlyRevenue ?? undefined,
      employees: employees ?? undefined,
      floodAffected,
      hasRaast,
      needsGrantOnly,
    }),
    [sizeTab, businessType, monthlyRevenue, employees, floodAffected, hasRaast, needsGrantOnly],
  );

  const hasProfileFilters = Boolean(
    businessType.trim() ||
      monthlyRevenue !== null ||
      employees !== null ||
      floodAffected ||
      hasRaast ||
      needsGrantOnly,
  );

  const ranked = useMemo(() => matchBusinessSchemes(profile), [profile]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ranked.filter(({ scheme }) => {
      if (sizeTab !== "all" && scheme.size !== sizeTab) return false;
      if (!q) return true;
      return [scheme.name, scheme.code, scheme.summary, scheme.fundingType, ...scheme.sectors]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [ranked, sizeTab, query]);

  const topMatch = useMemo(
    () => (hasProfileFilters ? ranked.find(r => r.fit === "recommended") ?? ranked[0] ?? null : null),
    [hasProfileFilters, ranked],
  );

  const snapshotRef = useRef({
    sizeTab,
    query,
    businessType,
    monthlyRevenuePkr: monthlyRevenue ?? undefined,
    employees: employees ?? undefined,
    topRecommendedName: topMatch?.scheme.name,
    topRecommendedId: topMatch?.scheme.id,
    visibleCount: visible.length,
    appliedCount: appliedIds.length,
  });
  snapshotRef.current = {
    sizeTab,
    query,
    businessType,
    monthlyRevenuePkr: monthlyRevenue ?? undefined,
    employees: employees ?? undefined,
    topRecommendedName: topMatch?.scheme.name,
    topRecommendedId: topMatch?.scheme.id,
    visibleCount: visible.length,
    appliedCount: appliedIds.length,
  };

  useEffect(() => {
    cuaEngine.schemes = {
      getSnapshot: () => ({ ...snapshotRef.current }),
      applyQuery: next => {
        if (next.size) setSizeTab(next.size);
        if (next.query !== undefined) setQuery(next.query);
        if (next.businessType !== undefined) setBusinessType(next.businessType);
        if (next.monthlyRevenuePkr !== undefined) setMonthlyRevenue(next.monthlyRevenuePkr);
        if (next.employees !== undefined) setEmployees(next.employees);
        if (next.floodAffected !== undefined) setFloodAffected(next.floodAffected);
        if (next.hasRaast !== undefined) setHasRaast(next.hasRaast);
        if (next.needsGrantOnly !== undefined) setNeedsGrantOnly(next.needsGrantOnly);
        if (next.recommendedId) setHighlightedId(next.recommendedId);
      },
      openApply: schemeId => {
        const found = BUSINESS_SCHEMES.find(s => s.id === schemeId);
        if (found) setApplyScheme(found);
      },
    };
    return () => {
      cuaEngine.schemes = null;
    };
  }, []);

  function resetMatcher() {
    setBusinessType("");
    setMonthlyRevenue(null);
    setEmployees(null);
    setFloodAffected(false);
    setHasRaast(false);
    setNeedsGrantOnly(false);
    setHighlightedId(null);
    setQuery("");
    setSizeTab("all");
  }

  function submitSimulatedApplication() {
    if (!applyScheme) return;
    setAppliedIds(prev => (prev.includes(applyScheme.id) ? prev : [...prev, applyScheme.id]));
    setNotice(`Simulated pre-application queued for ${applyScheme.name} (${applyScheme.code}).`);
    setApplyScheme(null);
  }

  return (
    <VStack gap={4} width="100%">
      {notice && <Banner status="success" title={notice} />}

      {/* Header & Size Tabs */}
      <HStack justify="between" vAlign="center" gap={3} wrap="wrap" width="100%">
        <VStack gap={0.5}>
          <Heading level={2}>Business Schemes</Heading>
          <Text type="supporting" color="secondary">
            Small &amp; large business relief grants and credit lines (simulated). Tell the voice assistant your shop details to match instantly.
          </Text>
        </VStack>
        <TabList value={sizeTab} onChange={v => setSizeTab(v as "all" | "small" | "large")}>
          <Tab value="all" label={`All (${BUSINESS_SCHEMES.length})`} />
          <Tab value="small" label={`Small (${BUSINESS_SCHEMES.filter(s => s.size === "small").length})`} />
          <Tab value="large" label={`Large (${BUSINESS_SCHEMES.filter(s => s.size === "large").length})`} />
        </TabList>
      </HStack>

      {/* On-the-fly Business Details Matcher */}
      <Card variant="muted" padding={4}>
        <VStack gap={3} width="100%">
          <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
            <HStack gap={1.5} vAlign="center">
              <Icon icon={Sparkles} size="sm" color="secondary" />
              <Text weight="semibold">Quick Eligibility Matcher</Text>
            </HStack>
            {hasProfileFilters && (
              <Button variant="ghost" size="sm" label="Reset filters" onClick={resetMatcher} />
            )}
          </HStack>

          <Grid columns={{ minWidth: 160, max: 4 }} gap={2} width="100%">
            <TextInput
              label="Search schemes"
              value={query}
              onChange={setQuery}
              placeholder="e.g. karyana, flood, export"
            />
            <TextInput
              label="Business type"
              value={businessType}
              onChange={setBusinessType}
              placeholder="e.g. karyana, wholesale, factory"
            />
            <NumberInput
              label="Monthly sales (PKR)"
              value={monthlyRevenue}
              onChange={setMonthlyRevenue}
              min={0}
              placeholder="e.g. 200000"
            />
            <NumberInput
              label="Staff count"
              value={employees}
              onChange={setEmployees}
              min={1}
              placeholder="e.g. 3"
            />
          </Grid>

          <HStack gap={2} wrap="wrap" vAlign="center">
            <ToggleButton
              label="Flood / disruption hit"
              size="sm"
              isPressed={floodAffected}
              onPressedChange={setFloodAffected}
            />
            <ToggleButton
              label="Accepts Raast QR"
              size="sm"
              isPressed={hasRaast}
              onPressedChange={setHasRaast}
            />
            <ToggleButton
              label="Grant only (0%)"
              size="sm"
              isPressed={needsGrantOnly}
              onPressedChange={setNeedsGrantOnly}
            />
          </HStack>

          {topMatch && topMatch.fit !== "not_eligible" && (
            <Banner
              status="success"
              title={`Recommended: Apply to ${topMatch.scheme.name}`}
              description={`${topMatch.scheme.fundingType} up to ${pkr(topMatch.scheme.maxAmountPkr)} · ${topMatch.reasons.join(" · ")}`}
            />
          )}
        </VStack>
      </Card>

      {/* Schemes Grid */}
      {visible.length === 0 ? (
        <EmptyState
          isCompact
          title="No matching business schemes"
          description="Try clearing the search query or switching between Small and Large business tabs."
        />
      ) : (
        <Grid columns={{ minWidth: 270, max: 2 }} gap={3} width="100%">
          {visible.map(({ scheme, fit, score, reasons }) => {
            const isHighlighted = highlightedId === scheme.id || (hasProfileFilters && topMatch?.scheme.id === scheme.id);
            const isApplied = appliedIds.includes(scheme.id);
            const fitBadge =
              fit === "recommended"
                ? { label: `Best match · ${score}%`, variant: "success" as const }
                : fit === "not_eligible"
                  ? { label: "Outside criteria", variant: "warning" as const }
                  : { label: hasProfileFilters ? `Possible · ${score}%` : scheme.fundingType, variant: "info" as const };

            return (
              <Card
                key={scheme.id}
                padding={4}
                variant={isHighlighted ? "green" : "default"}
              >
                <VStack gap={2} width="100%">
                  <HStack justify="between" vAlign="start" gap={2} width="100%">
                    <HStack gap={1.5} vAlign="center">
                      <Icon icon={scheme.size === "small" ? Store : Building2} size="sm" color="secondary" />
                      <Token
                        label={scheme.size === "small" ? "Small Business" : "Large Business"}
                        size="sm"
                        color={scheme.size === "small" ? "teal" : "blue"}
                      />
                    </HStack>
                    <Badge label={fitBadge.label} variant={fitBadge.variant} />
                  </HStack>

                  <VStack gap={0.5}>
                    <Heading level={4}>{scheme.name}</Heading>
                    <Text type="supporting" color="secondary">
                      {scheme.fundingType} · Up to {pkr(scheme.maxAmountPkr)}
                    </Text>
                  </VStack>

                  <ProgressBar
                    label={`Match score ${score}%`}
                    value={hasProfileFilters ? score : scheme.size === "small" ? 80 : 65}
                    max={100}
                    variant={
                      !hasProfileFilters
                        ? "accent"
                        : fit === "recommended"
                          ? "success"
                          : fit === "not_eligible"
                            ? "warning"
                            : "accent"
                    }
                    isLabelHidden
                  />

                  <HStack gap={1} wrap="wrap">
                    <Token
                      label={`≤ ${pkr(scheme.maxMonthlyRevenuePkr)}/mo`}
                      size="sm"
                      color="gray"
                    />
                    <Token
                      label={`${scheme.minEmployees}–${scheme.maxEmployees} staff`}
                      size="sm"
                      color="gray"
                    />
                  </HStack>

                  {hasProfileFilters && reasons.length > 0 && (
                    <Text type="supporting" color="secondary">
                      {reasons.slice(0, 2).join(" · ")}
                    </Text>
                  )}

                  <HStack gap={1} wrap="wrap">
                    {scheme.requiredDocs.map(doc => (
                      <Token key={doc} label={doc} size="sm" color="gray" />
                    ))}
                  </HStack>

                  <HStack justify="between" vAlign="center" gap={2} width="100%">
                    <Text type="supporting" color="secondary">
                      {scheme.disbursementRail}
                    </Text>
                    <Button
                      variant={isApplied ? "secondary" : isHighlighted ? "primary" : "secondary"}
                      size="sm"
                      label={isApplied ? "Pre-applied" : "Apply to scheme"}
                      icon={isApplied ? <Icon icon={CheckCircle2} size="sm" /> : undefined}
                      isDisabled={ctx.offline}
                      onClick={() => setApplyScheme(scheme)}
                    />
                  </HStack>
                </VStack>
              </Card>
            );
          })}
        </Grid>
      )}

      {/* Simulated Scheme Pre-Application Dialog */}
      <Dialog
        isOpen={Boolean(applyScheme)}
        onOpenChange={open => {
          if (!open) setApplyScheme(null);
        }}
        width={460}
        maxHeight="85dvh"
        padding={4}
        purpose="form"
      >
        {applyScheme && (
          <VStack gap={3} width="100%">
            <DialogHeader
              title={applyScheme.name}
              subtitle={`${applyScheme.code} · Up to ${pkr(applyScheme.maxAmountPkr)} (${applyScheme.fundingType})`}
              onOpenChange={open => {
                if (!open) setApplyScheme(null);
              }}
            />

            <Text type="supporting" color="secondary">
              Prototype check for {ctx.profile.full_name}. Confirm your business profile details below to queue a simulated application.
            </Text>

            <Selector
              label="Business size tier"
              value={applyScheme.size}
              onChange={() => {}}
              isDisabled
              options={[
                { value: "small", label: "Small Business / Micro-Enterprise" },
                { value: "large", label: "Medium / Large Business" },
              ]}
            />

            <TextInput
              label="Shop / Business type"
              value={businessType || "Karyana / Retail Store"}
              onChange={setBusinessType}
            />

            <HStack gap={2} width="100%">
              <NumberInput
                label="Monthly sales (PKR)"
                value={monthlyRevenue ?? 180000}
                onChange={setMonthlyRevenue}
                min={0}
              />
              <NumberInput
                label="Staff count"
                value={employees ?? 3}
                onChange={setEmployees}
                min={1}
              />
            </HStack>

            <VStack gap={1}>
              <Text type="supporting" weight="semibold">Required synthetic documents</Text>
              <HStack gap={1} wrap="wrap">
                {applyScheme.requiredDocs.map(doc => (
                  <Token key={doc} label={doc} size="sm" color="gray" />
                ))}
              </HStack>
            </VStack>

            <HStack justify="end" gap={2} width="100%">
              <Button variant="ghost" label="Cancel" onClick={() => setApplyScheme(null)} />
              <Button variant="primary" label="Submit simulated pre-check" onClick={submitSimulatedApplication} />
            </HStack>
          </VStack>
        )}
      </Dialog>
    </VStack>
  );
}
