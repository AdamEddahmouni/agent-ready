/**
 * The Agent-Ready contract's verification surface (ADR-0046 §6).
 *
 * One fact, one kind, one rule: this is what a **maintainer declared** is
 * required, and it is kept strictly apart from what the repository *shows*.
 *
 * The separation is the whole point, and it is the property the later benchmark
 * depends on. Three consequences follow, each pinned by a test:
 *
 *  1. It never overwrites. A contract naming `test` does not make a `test`
 *     script exist. If no package declares one, both facts stand and the
 *     disagreement is visible — information for a later drift check, and
 *     explicitly **not** an error here. Discovery is not a linter.
 *  2. Repository-derived command facts are byte-identical with and without a
 *     contract. A maintainer's description of a repository must not change the
 *     model's account of the repository.
 *  3. It never selects an executable. An `author-declared` package manager is
 *     excluded from invocation derivation in `commands/invocation.ts`, for the
 *     same reason it is excluded from the package-manager fact's value: a claim
 *     *about* the repository is not a statement *by* it.
 */

import type { DiscoveryProbe } from "../probe.js";
import { CANONICAL_CONTRACT_FILENAME } from "../../contract/discovery.js";

/**
 * The contract's `verification.required` names, in the order they were written.
 *
 * `author-declared` and only `author-declared`. ADR-0044's four epistemic kinds
 * already have a home for a human's claim, and using it here is what stops a
 * maintainer's word from arriving as repository truth.
 *
 * The order is **not** canonicalised. Every other derived collection in the
 * snapshot is code-unit sorted because its order carries no meaning; this one is
 * a sequence the maintainer chose, and `lint` before `test` is a declaration
 * about order, not an accident of spelling.
 */
export const contractVerificationProbe: DiscoveryProbe = {
  id: "contract.verification",
  factId: "repository.contract.verification",
  kind: "author-declared",
  shape: "value",
  async run(context) {
    const required = await context.readContractVerification();
    if (required === undefined) {
      // Absent, invalid, or unreadable contract. There is nothing to declare,
      // and saying so as `no-evidence` keeps a broken contract from taking the
      // repository's own command facts down with it.
      return {
        status: "not-found",
        evidence: [
          { source: CANONICAL_CONTRACT_FILENAME, detail: "declares no verification sequence" },
        ],
      };
    }
    return {
      status: "found",
      value: [...required],
      evidence: [
        {
          source: CANONICAL_CONTRACT_FILENAME,
          pointer: "/verification/required",
          detail: "author-declared verification sequence, in declared order",
        },
      ],
    };
  },
};
