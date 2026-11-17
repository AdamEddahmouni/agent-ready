/**
 * The contract's contribution to discovery.
 *
 * ADR-0044 allows `agent-ready.yaml` to contribute facts, and the whole reason
 * is in three rules it states. This probe is where they are enforced:
 *
 *  1. A claim from the contract is `author-declared`, never `declared` and
 *     never `derived`. A maintainer's description is a claim _about_ the
 *     repository, not a fact _of_ it, and the kind is what keeps the Phase 1
 *     evaluation honest.
 *  2. It never overwrites repository evidence. Both claims are retained and a
 *     disagreement is published by the merge, so there is nothing for this
 *     probe to do about conflicts.
 *  3. It changes which facts become _available_, never which become _true_. The
 *     only thing it adds is one claim, and it is added whether or not the
 *     repository agrees.
 *
 * That third rule is why the probe exists at all rather than being left for
 * later: an existing user's contract is real signal, and discarding it would
 * make `discover` artificially weak on exactly the repositories it is meant to
 * help with.
 */

import { CANONICAL_CONTRACT_FILENAME } from "../../contract/discovery.js";
import type { DiscoveryProbe } from "../probe.js";
import { ROOT_MANIFEST } from "../packages/packageManager.js";
import { ROOT_PACKAGE_SCOPE, packageManagerFactId } from "../types.js";

/** The contract field a package-manager claim is read from. */
const CONTRACT_POINTER = "/environment/packageManager";

/**
 * Reports the contract's package-manager claim, if it makes one.
 *
 * Claims only about the **root** identity. A contract describes the repository
 * as a whole, so attributing its claim to a nested package would be inventing a
 * scope the contract never expressed. A nested manifest that declares its own
 * manager is reported by the declaration probe as `declared`, and the two facts
 * stay separate — which is the non-flattening property ADR-0045 §3 requires.
 */
export const contractPackageManagerClaimProbe: DiscoveryProbe = {
  id: "contract.package-manager-claim",
  factId: "repository.packageManager.root",
  kind: "author-declared",
  shape: "value",
  async run(context) {
    const claim = await context.readContractPackageManager();
    if (claim === undefined) {
      return {
        status: "not-found",
        evidence: [
          {
            source: CANONICAL_CONTRACT_FILENAME,
            pointer: CONTRACT_POINTER,
            detail: "not declared",
          },
        ],
      };
    }
    return {
      status: "asserted",
      claims: [
        {
          factId: packageManagerFactId(ROOT_PACKAGE_SCOPE),
          kind: "author-declared",
          // The contract's own rendering, `<name>@<version>`, matching the shape
          // a `packageManager` declaration takes. That symmetry is what lets a
          // declared claim and a contract claim be compared on one axis instead
          // of being compared as two different kinds of text.
          value: `${claim.name}@${claim.version}`,
          projected: claim.name,
          evidence: [
            {
              source: CANONICAL_CONTRACT_FILENAME,
              pointer: CONTRACT_POINTER,
              detail: "claimed by the contract, not observed from the repository",
            },
          ],
        },
      ],
    };
  },
};

export { CANONICAL_CONTRACT_FILENAME, ROOT_MANIFEST };
