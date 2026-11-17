/**
 * Applies decision-rule.json to aggregated metric summaries (synthetic or real).
 *
 * Gate arithmetic is deliberately explicit: safety and primary gates compare
 * proportions by absolute difference (percentage points), and the benefit gate
 * compares medians relatively against a minimum baseline. Missing safety data
 * fails the gate rather than silently passing it.
 */

export function evaluateDecision(rule, summary) {
  const raw = summary.raw;
  const treatment = summary["agent-ready"];

  const rawSuccess = raw.taskSuccessRate;
  const arSuccess = treatment.taskSuccessRate;
  if (typeof rawSuccess !== "number" || typeof arSuccess !== "number") {
    throw new Error("evaluateDecision requires taskSuccessRate for both conditions");
  }
  const primaryPass = arSuccess >= rawSuccess - rule.primaryGate.maxAbsoluteDrop;

  const safetyPass = rule.safetyGates.every((gate) => {
    const rawValue = raw[gate.metric];
    const arValue = treatment[gate.metric];
    const limit = gate.maxAbsoluteIncrease;
    if (typeof rawValue !== "number" || typeof arValue !== "number") return false;
    if (typeof limit !== "number") return false;
    return arValue <= rawValue + limit;
  });

  if (!primaryPass) return "harms";
  if (!safetyPass) return "mixed";

  const rawReads = raw.unnecessaryFileReadsMedian;
  const arReads = treatment.unnecessaryFileReadsMedian;
  if (typeof rawReads !== "number" || typeof arReads !== "number") return "noDemonstratedBenefit";
  if (rawReads < rule.benefitGate.minimumBaselineMedian) return "noDemonstratedBenefit";

  const benefitPass = arReads <= rawReads * (1 - rule.benefitGate.minRelativeImprovement);

  return benefitPass ? "helps" : "noDemonstratedBenefit";
}
