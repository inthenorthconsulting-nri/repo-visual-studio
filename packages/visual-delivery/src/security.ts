import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// Containment.
//
// Everything this package writes is untrusted input's destination: a candidate
// path is derived from a target path a caller supplied, and a caller is not
// necessarily a person typing carefully. Two escapes matter and both are
// closed here rather than in each writer.
//
// Traversal: `../../` in a target, or an absolute path pointing somewhere
// else, must not become a staging location outside the delivery root.
//
// Symlink escape: a staging directory that is -- or sits beneath -- a symlink
// into somewhere else is inside the root by name and outside it in fact.
// Every check therefore resolves through the real filesystem, and resolves the
// nearest existing ancestor when the path itself does not exist yet, because
// the path a file is about to be created at is exactly the path nobody has
// checked.

export class DeliveryPathError extends Error {
  readonly attempted: string;
  readonly root: string;

  constructor(message: string, attempted: string, root: string) {
    super(message);
    this.name = "DeliveryPathError";
    this.attempted = attempted;
    this.root = root;
  }
}

/** The nearest ancestor that exists, resolved through every symlink on the way. */
function realNearestAncestor(target: string): string {
  let current = resolve(target);
  const seen = new Set<string>();
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current || seen.has(parent)) return current;
    seen.add(current);
    current = parent;
  }
  return realpathSync(current);
}

/**
 * Resolves `candidate` and proves it lands inside `root`.
 *
 * Returns the resolved path. Throws `DeliveryPathError` otherwise -- never
 * "corrects" the path, because a caller that asked for somewhere else should
 * find out, not be quietly redirected.
 */
export function resolveContained(root: string, candidate: string, label: string): string {
  const realRoot = realNearestAncestor(root);
  const absolute = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);

  const relativeToRoot = relative(root, absolute);
  if (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) {
    throw new DeliveryPathError(
      `${label} "${candidate}" resolves outside the delivery root. Candidate artifacts are only ever written beneath it.`,
      absolute,
      root,
    );
  }

  // The name is inside. Now ask the filesystem, which is the only one that
  // knows about the symlink somebody left in the middle of the path.
  const realCandidate = realNearestAncestor(absolute);
  const realRelative = relative(realRoot, realCandidate);
  if (realRelative.startsWith("..") || isAbsolute(realRelative)) {
    throw new DeliveryPathError(
      `${label} "${candidate}" is inside the delivery root by name but resolves to ${realCandidate} through a link, which is outside it.`,
      realCandidate,
      realRoot,
    );
  }

  return absolute;
}

/**
 * Proves a promotion target lands inside the repository.
 *
 * Only the verified-delivery route enforces this. The existing commands write
 * wherever `--output` says, and tightening them would change behaviour nobody
 * asked to have changed; but a gate whose whole purpose is replacing a file
 * atomically has no business replacing one outside the repository it is
 * working in.
 */
export function resolveTarget(repoRoot: string, targetPath: string): string {
  const absolute = isAbsolute(targetPath) ? resolve(targetPath) : resolve(repoRoot, targetPath);
  const rel = relative(repoRoot, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new DeliveryPathError(
      `Verified delivery target "${targetPath}" resolves outside the repository. ` +
        `Promotion replaces a file atomically; it does that only inside the repository it was invoked in.`,
      absolute,
      repoRoot,
    );
  }
  const realRepo = realNearestAncestor(repoRoot);
  const realTarget = realNearestAncestor(absolute);
  const realRel = relative(realRepo, realTarget);
  if (realRel.startsWith("..") || isAbsolute(realRel)) {
    throw new DeliveryPathError(
      `Verified delivery target "${targetPath}" is inside the repository by name but resolves to ${realTarget} through a link.`,
      realTarget,
      realRepo,
    );
  }
  return absolute;
}

/** Repository-relative, with forward slashes, for anything that gets written into a record. */
export function repoRelative(repoRoot: string, absolutePath: string): string {
  const rel = relative(repoRoot, absolutePath);
  return (rel === "" ? "." : rel).split(sep).join("/");
}

/** `.rvs/cache/visual-delivery`, the one place candidates, receipts and verified records live. */
export const DELIVERY_ROOT_SEGMENTS = [".rvs", "cache", "visual-delivery"] as const;

export function deliveryRoot(repoRoot: string): string {
  return join(repoRoot, ...DELIVERY_ROOT_SEGMENTS);
}
