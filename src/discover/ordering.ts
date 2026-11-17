/**
 * The one ordering rule discovery sorts by.
 *
 * Every ordered output in a discovery snapshot — facts, claims, evidence,
 * diagnostics, packages, workspace candidates, patterns, truncation reports —
 * is sorted in **code-unit** order, and the reason is that the snapshot's bytes
 * must not depend on the machine that produced them.
 *
 * `Array.prototype.sort` without a comparator already compares strings by UTF-16
 * code unit, so the tempting shortcut is to call `sort()` and move on. Two
 * things make that the wrong call here. First, the default comparator is
 * invisible at the call site, so a reader cannot tell which ordering a list uses
 * without checking the spec; a named call states it. Second, and worse, the
 * natural-looking alternative is `localeCompare`, whose result depends on the
 * host's locale: the same repository would produce differently ordered facts on
 * two machines, and a byte-comparison test would pass on the developer's
 * checkout and fail in CI, or the reverse. A snapshot is only deterministic if
 * the comparison is pinned somewhere one reader will look.
 *
 * Hence a single exported function rather than seven identical private copies.
 * The copies were not wrong, but they were seven places to forget the rule, and
 * the rule is the load-bearing part.
 */

/**
 * Compares two strings by UTF-16 code unit.
 *
 * Total, transitive, and locale-independent by construction: there is no
 * collation, no case folding, and no numeric interpretation. `<` on strings in
 * JavaScript is exactly this comparison.
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
