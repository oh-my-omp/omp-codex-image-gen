import { constants } from "node:fs";
import { link, mkdir, open, realpath, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { ExtensionError, cancelledError } from "../errors.ts";
import type { ApprovedRootAnchor } from "./paths.ts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export function decodePngBase64(value: string, maximumBytes = DEFAULT_MAX_IMAGE_BYTES): Buffer {
  const encoded = value.trim();
  const estimatedBytes = Math.floor((encoded.length * 3) / 4);
  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
    estimatedBytes > maximumBytes + 2
  ) {
    throw invalidImage();
  }

  const bytes = Buffer.from(encoded, "base64");
  // The regex above fixes the character table, the length and the padding
  // position, so the only remaining non-canonical form is non-zero unused bits
  // in the final quantum (they vanish when re-encoding). Checking that directly
  // replaces the whole-payload re-encode comparison.
  if (bytes.length > maximumBytes || !hasCanonicalTail(encoded) || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw invalidImage();
  }
  return bytes;
}

// `encoded` passed the character-table, length and padding checks; the only
// remaining non-canonical form is unused non-zero sextet bits in the tail
// quantum: one padding char leaves 2 such bits, two leave 4, none leaves none.
function hasCanonicalTail(encoded: string): boolean {
  const padding = (encoded.charCodeAt(encoded.length - 1) === 61 ? 1 : 0) + (encoded.charCodeAt(encoded.length - 2) === 61 ? 1 : 0);
  if (padding === 0) return true;
  const code = encoded.charCodeAt(encoded.length - 1 - padding);
  let sextet: number;
  if (code >= 65 && code <= 90) sextet = code - 65; // A-Z
  else if (code >= 97 && code <= 122) sextet = code - 71; // a-z
  else if (code >= 48 && code <= 57) sextet = code + 4; // 0-9
  else if (code === 43) sextet = 62; // +
  else if (code === 47) sextet = 63; // /
  else return false; // unreachable: the regex leaves no other character here
  return (sextet & ((1 << 2 * padding) - 1)) === 0;
}

type MutationQueue = <T>(path: string, operation: () => Promise<T>) => Promise<T>;

/**
 * Serialize file mutations that target the same path so two concurrent image
 * saves never race on one candidate filename. Upstream imported
 * `withFileMutationQueue` from the host package; Oh My Pi does not export it, so
 * an equivalent per-path promise chain lives here, the queue's only consumer.
 */
const pathMutationQueue = new Map<string, Promise<unknown>>();

export function withFileMutationQueue<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = pathMutationQueue.get(path) ?? Promise.resolve();
  const run = previous.then(() => operation());
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  pathMutationQueue.set(path, settled);
  void settled.finally(() => {
    if (pathMutationQueue.get(path) === settled) pathMutationQueue.delete(path);
  });
  return run;
}

export class ImageStore {
  private readonly queue: MutationQueue;

  constructor(queue: MutationQueue = withFileMutationQueue) {
    this.queue = queue;
  }

  async save(
    bytes: Buffer,
    desiredPath: string,
    signal?: AbortSignal,
    plannedRoot?: ApprovedRootAnchor,
  ): Promise<string> {
    try {
      if (signal?.aborted) throw cancelledError();
      const root = plannedRoot ?? (await captureCurrentAnchor(dirname(desiredPath)));
      await assertAnchorUnchanged(root);
      await mkdir(dirname(desiredPath), { recursive: true });
      await assertAnchorUnchanged(root);

      const directory = await realpath(dirname(desiredPath));
      assertWithin(root.canonicalPath, directory);
      const directoryStat = await stat(directory);
      const directoryIdentity = { device: directoryStat.dev, inode: directoryStat.ino };
      const canonicalDesiredPath = join(directory, basename(desiredPath));
      const canonicalSavedPath = await writeToAvailablePath(
        bytes,
        canonicalDesiredPath,
        root,
        directoryIdentity,
        this.queue,
        signal,
      );
      return join(dirname(desiredPath), basename(canonicalSavedPath));
    } catch (error) {
      if (error instanceof ExtensionError) throw error;
      throw new ExtensionError("SAVE_FAILED", "The generated PNG could not be saved.");
    }
  }
}

interface DirectoryIdentity {
  device: number;
  inode: number;
}

async function writeToAvailablePath(
  bytes: Buffer,
  desiredPath: string,
  root: ApprovedRootAnchor,
  directoryIdentity: DirectoryIdentity,
  queue: MutationQueue,
  signal?: AbortSignal,
): Promise<string> {
  const extension = extname(desiredPath);
  const stem = desiredPath.slice(0, desiredPath.length - extension.length);

  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidate = suffix === 1 ? desiredPath : `${stem}-${suffix}${extension}`;
    const saved = await queue(candidate, async () =>
      tryInstallCandidate(bytes, candidate, root, directoryIdentity, signal),
    );
    if (saved) return candidate;
  }

  throw new ExtensionError("SAVE_FAILED", "Could not allocate a unique PNG filename.");
}

async function tryInstallCandidate(
  bytes: Buffer,
  finalPath: string,
  root: ApprovedRootAnchor,
  directoryIdentity: DirectoryIdentity,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) throw cancelledError();
  await assertMutationLocation(dirname(finalPath), root, directoryIdentity);

  const temporaryPath = join(dirname(finalPath), `.${basename(finalPath)}.${randomUUID()}.tmp`);
  let installedIdentity: DirectoryIdentity | undefined;
  try {
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
    const temporary = await open(temporaryPath, flags, 0o600);
    try {
      await temporary.writeFile(bytes);
      await temporary.sync();
      const temporaryStat = await temporary.stat();
      installedIdentity = { device: temporaryStat.dev, inode: temporaryStat.ino };
    } finally {
      await temporary.close();
    }
    if (signal?.aborted) throw cancelledError();
    await assertMutationLocation(dirname(finalPath), root, directoryIdentity);
    try {
      await link(temporaryPath, finalPath);
    } catch (error) {
      if (isAlreadyExists(error)) return false;
      throw error;
    }
    await assertMutationLocation(dirname(finalPath), root, directoryIdentity);
    return true;
  } catch (error) {
    if (installedIdentity) await unlinkIfIdentityMatches(finalPath, installedIdentity);
    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function assertMutationLocation(
  directory: string,
  root: ApprovedRootAnchor,
  expectedDirectory: DirectoryIdentity,
): Promise<void> {
  await assertAnchorUnchanged(root);
  const currentDirectory = await realpath(directory);
  assertWithin(root.canonicalPath, currentDirectory);
  const current = await stat(currentDirectory);
  if (current.dev !== expectedDirectory.device || current.ino !== expectedDirectory.inode) {
    throw new ExtensionError("SAVE_FAILED", "The output directory changed while the PNG was being saved.");
  }
}

async function captureCurrentAnchor(path: string): Promise<ApprovedRootAnchor> {
  let existing = resolve(path);
  while (true) {
    try {
      const canonicalPath = await realpath(existing);
      const identity = await stat(canonicalPath);
      return { canonicalPath, device: identity.dev, inode: identity.ino };
    } catch {
      const parent = dirname(existing);
      if (parent === existing) throw new ExtensionError("SAVE_FAILED", "The output root is not accessible.");
      existing = parent;
    }
  }
}

async function assertAnchorUnchanged(root: ApprovedRootAnchor): Promise<void> {
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(root.canonicalPath);
  } catch {
    throw new ExtensionError("SAVE_FAILED", "The approved output root changed before the PNG was saved.");
  }
  const current = await stat(canonicalPath);
  if (
    canonicalPath !== root.canonicalPath ||
    current.dev !== root.device ||
    current.ino !== root.inode
  ) {
    throw new ExtensionError("SAVE_FAILED", "The approved output root changed before the PNG was saved.");
  }
}

async function unlinkIfIdentityMatches(path: string, expected: DirectoryIdentity): Promise<void> {
  try {
    const current = await stat(path);
    if (current.dev === expected.device && current.ino === expected.inode) await unlink(path);
  } catch {
    // The failed publication left no matching file to clean up.
  }
}

function assertWithin(root: string, candidate: string): void {
  const relation = relative(resolve(root), resolve(candidate));
  if (relation !== "" && (relation.startsWith("..") || isAbsolute(relation))) {
    throw new ExtensionError("SAVE_FAILED", "The output path escaped its approved root.");
  }
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function invalidImage(): ExtensionError {
  return new ExtensionError("NO_IMAGE", "The Codex image service returned invalid or oversized PNG data.");
}
