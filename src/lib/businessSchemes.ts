export type BusinessSize = "small" | "large";

export type BusinessScheme = {
  id: string;
  code: string;
  name: string;
  size: BusinessSize;
  fundingType: "Grant (0%)" | "0% Micro-Loan" | "Subsidized Credit" | "Merchant Incentive";
  maxAmountPkr: number;
  minMonthlyRevenuePkr: number;
  maxMonthlyRevenuePkr: number;
  minEmployees: number;
  maxEmployees: number;
  sectors: string[];
  floodPriority?: boolean;
  raastRequired?: boolean;
  summary: string;
  disbursementRail: string;
  requiredDocs: string[];
};

export type BusinessQueryProfile = {
  size?: BusinessSize | "all";
  businessType?: string;
  monthlyRevenuePkr?: number;
  employees?: number;
  floodAffected?: boolean;
  hasRaast?: boolean;
  needsGrantOnly?: boolean;
};

export type SchemeMatch = {
  scheme: BusinessScheme;
  fit: "recommended" | "possible" | "not_eligible";
  score: number;
  reasons: string[];
};

export const BUSINESS_SCHEMES: BusinessScheme[] = [
  {
    id: "karyana-flood-recovery",
    code: "SME-GRT-01",
    name: "Karyana & Micro-Shop Flood Recovery Grant",
    size: "small",
    fundingType: "Grant (0%)",
    maxAmountPkr: 150000,
    minMonthlyRevenuePkr: 0,
    maxMonthlyRevenuePkr: 350000,
    minEmployees: 1,
    maxEmployees: 6,
    sectors: ["karyana", "grocery", "retail", "general store", "shop", "food", "tailor", "repair"],
    floodPriority: true,
    summary: "Non-repayable emergency restocking grant for neighborhood karyana stores and micro-shops hit by flood or power disruption.",
    disbursementRail: "Simulated Raast Instant Merchant Credit",
    requiredDocs: ["Mock CNIC", "Shop utility bill", "Stock damage photo"],
  },
  {
    id: "micro-trade-working-capital",
    code: "SME-MIC-02",
    name: "PM Micro-Trade Zero-Markup Working Capital",
    size: "small",
    fundingType: "0% Micro-Loan",
    maxAmountPkr: 500000,
    minMonthlyRevenuePkr: 25000,
    maxMonthlyRevenuePkr: 750000,
    minEmployees: 1,
    maxEmployees: 12,
    sectors: ["karyana", "retail", "pharmacy", "tailor", "workshop", "restaurant", "bakery", "salon", "shop"],
    summary: "Interest-free working capital for small shops to restock inventory, add solar backup, or expand daily trade.",
    disbursementRail: "Simulated Raast / Microfinance Partner Bank",
    requiredDocs: ["Mock CNIC", "Shop rent or utility bill", "2-month sales ledger"],
  },
  {
    id: "raast-merchant-boost",
    code: "DPI-RST-03",
    name: "Digital Raast Merchant Incentive",
    size: "small",
    fundingType: "Merchant Incentive",
    maxAmountPkr: 75000,
    minMonthlyRevenuePkr: 0,
    maxMonthlyRevenuePkr: 1500000,
    minEmployees: 1,
    maxEmployees: 20,
    sectors: ["karyana", "retail", "pharmacy", "food", "service", "wholesale", "shop"],
    raastRequired: true,
    summary: "Zero MDR fee waiver plus PKR 75,000 working-capital bonus for shops accepting verified Raast QR and relief payouts.",
    disbursementRail: "Simulated Raast Merchant Account",
    requiredDocs: ["Mock CNIC", "Mock Raast Merchant ID", "Shopfront photo"],
  },
  {
    id: "women-colony-micro-fund",
    code: "SME-WMC-04",
    name: "Colony & Rural Micro-Enterprise Stabilization Grant",
    size: "small",
    fundingType: "Grant (0%)",
    maxAmountPkr: 120000,
    minMonthlyRevenuePkr: 0,
    maxMonthlyRevenuePkr: 300000,
    minEmployees: 1,
    maxEmployees: 5,
    sectors: ["stitching", "tailor", "home business", "karyana", "food", "craft", "retail"],
    summary: "Direct cash stabilization grant for home-based and colony micro-traders with limited collateral.",
    disbursementRail: "Simulated Raast Direct Transfer",
    requiredDocs: ["Mock CNIC", "Household utility bill", "Simple work proof"],
  },
  {
    id: "sme-supply-chain-credit",
    code: "LGB-SUP-05",
    name: "SME Wholesale & Cold-Storage Credit Line",
    size: "large",
    fundingType: "Subsidized Credit",
    maxAmountPkr: 5000000,
    minMonthlyRevenuePkr: 500000,
    maxMonthlyRevenuePkr: 10000000,
    minEmployees: 8,
    maxEmployees: 120,
    sectors: ["wholesale", "distributor", "agro", "cold storage", "logistics", "mart", "supermarket", "pharmacy"],
    summary: "Low-markup credit line for medium & large wholesalers, food distributors, and cold-storage operators maintaining regional supply.",
    disbursementRail: "Simulated Bank / Raast Bulk Settlement",
    requiredDocs: ["Mock NTN / Business Reg", "6-month bank statement", "Warehouse utility bill"],
  },
  {
    id: "large-enterprise-payroll-shield",
    code: "LGB-PAY-06",
    name: "Large Business Disaster Continuity & Payroll Shield",
    size: "large",
    fundingType: "Subsidized Credit",
    maxAmountPkr: 15000000,
    minMonthlyRevenuePkr: 1500000,
    maxMonthlyRevenuePkr: 100000000,
    minEmployees: 20,
    maxEmployees: 2000,
    sectors: ["factory", "manufacturing", "textile", "mill", "distributor", "retail chain", "warehouse", "enterprise"],
    floodPriority: true,
    summary: "Emergency payroll protection and solar/generator recovery financing for large employers keeping 20+ staff on payroll during disruptions.",
    disbursementRail: "Simulated Corporate Raast Payroll Rail",
    requiredDocs: ["Mock SECP / NTN", "Payroll roster", "Facility damage or utility record"],
  },
  {
    id: "export-wholesale-facility",
    code: "LGB-EXP-07",
    name: "Export & Large-Scale Trade Working Capital Facility",
    size: "large",
    fundingType: "Subsidized Credit",
    maxAmountPkr: 25000000,
    minMonthlyRevenuePkr: 2500000,
    maxMonthlyRevenuePkr: 250000000,
    minEmployees: 15,
    maxEmployees: 5000,
    sectors: ["export", "textile", "manufacturing", "agro", "wholesale", "rice", "leather", "enterprise"],
    summary: "Revolving working-capital line for large traders and exporters fulfilling bulk domestic or export orders.",
    disbursementRail: "Simulated SBP / Raast Trade Settlement",
    requiredDocs: ["Mock NTN & Export Reg", "Audited turnover summary", "Bank trade history"],
  },
];

export function matchBusinessSchemes(profile: BusinessQueryProfile): SchemeMatch[] {
  const typeText = (profile.businessType ?? "").trim().toLowerCase();
  const hasAnyCriteria =
    Boolean(typeText) ||
    typeof profile.monthlyRevenuePkr === "number" ||
    typeof profile.employees === "number" ||
    profile.floodAffected === true ||
    profile.hasRaast === true ||
    profile.needsGrantOnly === true ||
    (profile.size && profile.size !== "all");

  return BUSINESS_SCHEMES.map(scheme => {
    if (!hasAnyCriteria) {
      return {
        scheme,
        fit: "possible" as const,
        score: 50,
        reasons: ["Tell the assistant your business details to check personalized eligibility."],
      };
    }

    let score = 55;
    let disqualified = false;
    const reasons: string[] = [];

    if (profile.size && profile.size !== "all") {
      if (scheme.size === profile.size) {
        score += 15;
        reasons.push(`Matches ${profile.size} business tier`);
      } else {
        score -= 35;
        disqualified = true;
        reasons.push(`Designed for ${scheme.size} businesses`);
      }
    }

    if (typeof profile.monthlyRevenuePkr === "number" && profile.monthlyRevenuePkr >= 0) {
      const rev = profile.monthlyRevenuePkr;
      if (rev >= scheme.minMonthlyRevenuePkr && rev <= scheme.maxMonthlyRevenuePkr) {
        score += 20;
        reasons.push(`Monthly turnover fits PKR ${new Intl.NumberFormat("en-PK").format(scheme.minMonthlyRevenuePkr)}–${new Intl.NumberFormat("en-PK").format(scheme.maxMonthlyRevenuePkr)}`);
      } else if (rev > scheme.maxMonthlyRevenuePkr) {
        score -= 40;
        disqualified = true;
        reasons.push(`Turnover exceeds cap of PKR ${new Intl.NumberFormat("en-PK").format(scheme.maxMonthlyRevenuePkr)}/mo`);
      } else {
        score -= 30;
        disqualified = true;
        reasons.push(`Requires at least PKR ${new Intl.NumberFormat("en-PK").format(scheme.minMonthlyRevenuePkr)}/mo turnover`);
      }
    }

    if (typeof profile.employees === "number" && profile.employees > 0) {
      const emp = profile.employees;
      if (emp >= scheme.minEmployees && emp <= scheme.maxEmployees) {
        score += 15;
        reasons.push(`Staff size (${emp}) fits ${scheme.minEmployees}–${scheme.maxEmployees} range`);
      } else {
        score -= 30;
        disqualified = true;
        reasons.push(`Requires ${scheme.minEmployees}–${scheme.maxEmployees} staff`);
      }
    }

    if (typeText) {
      const sectorMatch = scheme.sectors.some(s => typeText.includes(s) || s.includes(typeText));
      if (sectorMatch) {
        score += 15;
        reasons.push(`Covers "${profile.businessType}" sector`);
      }
    }

    if (profile.floodAffected && scheme.floodPriority) {
      score += 18;
      reasons.push("Priority track for flood / disruption recovery");
    }

    if (profile.hasRaast && scheme.raastRequired) {
      score += 18;
      reasons.push("Qualifies for Raast merchant bonus");
    }

    if (profile.needsGrantOnly) {
      if (scheme.fundingType === "Grant (0%)" || scheme.fundingType === "Merchant Incentive") {
        score += 12;
        reasons.push("Non-repayable grant / incentive");
      } else {
        score -= 30;
        disqualified = true;
        reasons.push("Credit / loan facility (not a grant)");
      }
    }

    const bounded = Math.max(5, Math.min(99, score));
    const fit: SchemeMatch["fit"] = disqualified
      ? "not_eligible"
      : bounded >= 75
        ? "recommended"
        : "possible";

    return {
      scheme,
      fit,
      score: bounded,
      reasons: reasons.slice(0, 3),
    };
  }).sort((a, b) => b.score - a.score);
}
