import { CANONICAL_CONTRACT_FILENAME } from "../../contract/discovery.js";
import type { DiscoveryProbe, DiscoveryProbeContext } from "../probe.js";
import { safeStat } from "../read.js";

/**
 * Whether an `agent-ready.yaml` exists at the repository root.
 *
 * This is deliberately a bare `stat` and nothing more. It is the fact that
 * lets `discover` work in a repository nobody has described, and it must
 * answer even when the contract is unparseable: existence and validity are
 * different claims about different things.
 */
export const contractPresenceProbe: DiscoveryProbe = {
  id: "contract.presence",
  factId: "repository.contract.present",
  kind: "derived",
  shape: "existence",
  async run(context: DiscoveryProbeContext) {
    const stat = await safeStat(context, CANONICAL_CONTRACT_FILENAME);
    switch (stat.status) {
      case "present":
        return {
          status: "found",
          value: stat.isFile,
          evidence: [
            {
              source: CANONICAL_CONTRACT_FILENAME,
              detail: stat.isFile ? "a regular file" : "present but not a regular file",
            },
          ],
        };
      case "absent":
        return {
          status: "not-found",
          evidence: [{ source: CANONICAL_CONTRACT_FILENAME, detail: "not present" }],
        };
      case "failed":
        return {
          status: "failed",
          detail: stat.detail,
          evidence: [{ source: CANONICAL_CONTRACT_FILENAME, detail: "could not be inspected" }],
        };
    }
  },
};

/**
 * Whether the contract is valid.
 *
 * A malformed contract is reported as an invalid contract, never as a failed
 * discovery and never as a missing contract. The repository still exists, the
 * contract still exists, and only the contract's validity is unknown-good.
 */
export const contractValidityProbe: DiscoveryProbe = {
  id: "contract.validity",
  factId: "repository.contract.valid",
  kind: "derived",
  shape: "existence",
  async run(context: DiscoveryProbeContext) {
    const contract = await context.readContract();
    switch (contract.status) {
      case "valid":
        return {
          status: "found",
          value: true,
          evidence: [
            {
              source: CANONICAL_CONTRACT_FILENAME,
              detail: "parsed and validated against the contract schema",
            },
          ],
        };
      case "invalid":
        return {
          status: "found",
          value: false,
          evidence: [
            {
              source: CANONICAL_CONTRACT_FILENAME,
              detail: `present but not valid: ${contract.reason}`,
            },
          ],
        };
      case "absent":
        return {
          status: "unsupported",
          // There is nothing to be valid. That is an absence, and it produces no
          // diagnostic: `DISCOVERY_FACT_UNSUPPORTED` is raised from the manifest
          // layout, for a shape that was read and deliberately not interpreted.
          // A repository without a contract has no such shape.
          detail: "no contract exists, so its validity was not probed",
        };
      case "failed":
        return {
          status: "failed",
          detail: contract.detail,
          evidence: [{ source: CANONICAL_CONTRACT_FILENAME, detail: "could not be inspected" }],
        };
    }
  },
};
