/**
 * The command role grammar (ADR-0046 §3).
 *
 * This module is the narrowest thing in the repository that could be mistaken
 * for a heuristic, so it is worth being blunt about what it is and is not: it is
 * a four-line grammar over a **script's name**, and it is the only thing in
 * discovery that assigns a semantic role to a command.
 *
 * It does not look at the body. That is not an oversight and it is not a
 * simplification — it is the decision. A body mentioning `vitest` does not make
 * a script a test entrypoint, because commands wrap other scripts, tools span
 * several roles, and `"deploy": "npm test && ship"` contains the token
 * `npm test` while being nothing of the kind. Making that judgement reliably
 * means modelling a shell, which ADR-0046 §2 refuses, and doing it *unreliably*
 * means shipping a confidently wrong answer. Neither is available, so the body
 * is opaque and the name is the whole evidence.
 *
 * Everything here is a code constant rather than configuration, which is the
 * `derived` kind's requirement in ADR-0044: the same grammar applies to every
 * repository and cannot be tuned per repository to produce a nicer answer.
 */

import type { CommandRole } from "../types.js";

/**
 * The accepted role roots, in the published order.
 *
 * A fixed tuple rather than a `Set`, so a reader can see the entire vocabulary
 * without following a construction. Four is the whole vocabulary; a fifth is a
 * new decision with a new adversarial matrix, not a line added here.
 */
const ROLE_ROOTS: readonly CommandRole[] = ["test", "build", "lint", "typecheck"];

/** The separator that namespaces a script into a role family. */
const NAMESPACE_SEPARATOR = ":";

/**
 * A recognised verification role, and whether the name is exactly that role.
 *
 * `primary` means one thing and only one thing: the script's name **is** the
 * role root. It is not a safety claim and not a recommendation. `lint:fix` is
 * unambiguously in the `lint` namespace and just as unambiguously likely to
 * modify files; Agent-Ready claims the first from the name and refuses to
 * comment on the second, which is a claim about a string it did not read
 * (ADR-0046 §4).
 *
 * When both `test` and `test:unit` exist, the base name is distinguishable by
 * exact declared identity — a deterministic rule, not a ranking. When only
 * namespaced ones exist, none is primary and all are reported, because choosing
 * between `test:unit` and `test:integration` would be the guess this whole
 * module exists to prevent.
 */
export interface CommandRoleMatch {
  readonly role: CommandRole;
  readonly primary: boolean;
}

/**
 * Assigns a role to a script name, or reports that it has none.
 *
 * The grammar, mechanically:
 *
 * ```text
 * name  := ROOT | ROOT ":" SUFFIX
 * SUFFIX := one or more further ":"-separated segments
 * ROOT  := "test" | "build" | "lint" | "typecheck"
 * ```
 *
 * Anchored and exact. No substring matching, no case folding, no synonym table.
 * A name that does not fit has no role, and that is a fact about the
 * declaration rather than a diagnostic — a repository may name its scripts
 * anything at all without having done anything wrong.
 *
 * The consequences that make this a grammar rather than a keyword list:
 *
 * ```text
 * test        -> test       test:unit    -> test    test:build -> test (only)
 * test:       -> none       :test        -> none    TEST       -> none
 * pretest     -> none       contest      -> none    testdata   -> none
 * posttest    -> none       rebuild      -> none    testing    -> none
 * builder     -> none       eslint       -> none    linting   -> none
 * ```
 *
 * `pretest` and `posttest` are declared scripts and appear in the command
 * inventory, but they are package-manager *lifecycle hooks*: npm and friends run
 * them around `test`, they are not the entrypoint, and modelling when a
 * package manager fires them means emulating a package manager. ADR-0046 §3
 * declines to, so they carry no role.
 *
 * One name yields at most one role. A prefix grammar cannot produce two, and
 * nothing tries to: `test:build` belongs to `test`, because the grammar says so
 * and re-reading it as both would be interpretation.
 */
export function roleForScriptName(name: string): CommandRoleMatch | undefined {
  const separator = name.indexOf(NAMESPACE_SEPARATOR);
  // No separator, or a leading one: the name is not `ROOT` and not `ROOT:SUFFIX`.
  if (separator < 0) {
    return exactRole(name);
  }
  const root = name.slice(0, separator);
  const suffix = name.slice(separator + NAMESPACE_SEPARATOR.length);
  // The suffix must be non-empty. `test:` is a name the grammar does not
  // describe, and accepting it would mean accepting a spelling the maintainer
  // did not write as though it were the base name.
  if (suffix.length === 0) {
    return undefined;
  }
  const role = roleForRoot(root);
  return role === undefined ? undefined : { role, primary: false };
}

function exactRole(name: string): CommandRoleMatch | undefined {
  const role = roleForRoot(name);
  return role === undefined ? undefined : { role, primary: true };
}

function roleForRoot(root: string): CommandRole | undefined {
  return ROLE_ROOTS.find((candidate) => candidate === root);
}

/**
 * The published role vocabulary, in order.
 *
 * Exported so a consumer — and the human renderer — can enumerate the roles
 * without re-deriving the grammar. It is a read-only view: the grammar remains
 * the only way a role is ever assigned, and a caller cannot extend it.
 */
export function knownCommandRoles(): readonly CommandRole[] {
  return ROLE_ROOTS;
}
