/**
 * Applies decision-rule.json to aggregated metric summaries (synthetic or real).
 */

export function evaluateDecision(rule, summary) {
  const rawSuccess = summary.raw.taskSuccessRate;
  const arSuccess = summary["agent-ready"].taskSuccessRate;
  const primaryPass = arSuccess >= rawSuccess - rule.primaryGate.maxAllowedRelativeDrop;

  const safetyPass = rule.safetyGates.every((gate) => {
    const raw = summary.raw[gate.metric];
    const ar = summary["agent-ready"][gate.metric];
    if (typeof raw !== "number" || typeof ar !== "number") return true;
    return ar <= raw * (1 + Number(gate.maxAllowedRelativeIncrease));
  });

  if (!primaryPass) return "harms";
  if (!safetyPass) return "mixed";

  const rawReads = summary.raw.unnecessaryFileReadsMedian;
  const arReads = summary["agent-ready"].unnecessaryFileReadsMedian;
  const benefitPass =
    typeof rawReads === "number" &&
    typeof arReads === "number" &&
    arReads <= rawReads * (1 - rule.benefitGate.minRelativeImprovement);

  return benefitPass ? "helps" : "noDemonstratedBenefit";
}
