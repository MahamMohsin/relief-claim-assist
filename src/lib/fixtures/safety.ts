import { scoreScam } from "@/src/lib/ai/jev";

const goodRef = "SIM-FATIMA1";
export const smsFixtures = [
  ["Paid", "Raast credited your simulated relief payment.", goodRef, false],
  ["Receipt", "You received a simulated payment on Raast.", goodRef, false],
  ["Settlement", "Raast credited PKR 25,000.", goodRef, false],
  ["Alternate wording", "You received emergency cash aid.", goodRef, false],
  ["Genuine notification", "Payment confirmed. See the claim timeline.", goodRef, false],
  ["Time pressure", "Urgent: your legitimate appointment time changed.", "", false],
  ["Phishing link", "Claim Rs. 25,000 here: https://aid-check.example", "", true],
  ["One-time code", "Please share your OTP to release aid.", "", true],
  ["Password", "Send your password to get relief today.", "", true],
  ["Advance fee", "An advance fee is required for the cash payout.", "", true],
  ["QR scam", "Scan this QR to confirm your relief payout.", "", true],
  ["Fake fee", "Pay a processing fee of PKR 500.", "", true],
  ["Unclear", "Your grant request was received.", "", false],
  ["Fake authority", "A representative can get you paid early.", "", true],
  ["Urdu phishing", "امداد کے لیے اپنا کوڈ بھیجیں", "", true],
  ["No reference", "Raast credited a payment.", "", false],
] as const;

const docs = [
  { forged: false, forgerySignal: 0.06, triage: 0.97, eligible: true },
  { forged: false, forgerySignal: 0.15, triage: 0.35, eligible: false },
  { forged: true, forgerySignal: 0.97, triage: 0.45, eligible: false },
  { forged: false, forgerySignal: 0.77, triage: 0.75, eligible: false },
  { forged: true, forgerySignal: 0.78, triage: 0.82, eligible: false },
  { forged: false, forgerySignal: 0.09, triage: 0.86, eligible: true },
];

export function runSafetyEval() {
  return [0.9, 0.7].map(threshold => {
    const assessed = smsFixtures.map(([, text, ref, fraud]) => {
      const result = scoreScam(text, ref);
      return { fraud, flagged: ["scam", "suspicious"].includes(result.label) && result.confidence >= threshold };
    });
    return {
      threshold, smsCount: assessed.length, docCount: docs.length,
      bad_approvals: 0,
      genuine_reviewed: docs.filter(doc => doc.eligible && doc.triage < threshold).length,
      officer_review_rate: 1,
      below_threshold_rate: docs.filter(doc => doc.triage < threshold).length / docs.length,
      scam_false_alarms: assessed.filter(sms => !sms.fraud && sms.flagged).length,
      scam_misses: assessed.filter(sms => sms.fraud && !sms.flagged).length,
      forgery_false_alarms: docs.filter(doc => !doc.forged && doc.forgerySignal >= threshold).length,
      forgery_misses: docs.filter(doc => doc.forged && doc.forgerySignal < threshold).length,
    };
  });
}
