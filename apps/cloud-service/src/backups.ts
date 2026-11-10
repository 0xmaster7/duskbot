// Backups of each Boat home's volume, kept outside Boat in storage only this service writes: a home never holds a credential
// that reaches it. Each generation is one file, written once (O_EXCL) and never changed: AES-256-GCM over the volume's tar,
// keyed per cloud from a secret only this service holds (boatBackupKey): nothing on the home can open one. Version 1 files,
// keyed from the home's own bootstrap secret, are still read so the reconciler can seal them again as version 2.
// Only the retention reconciler removes one (boat-retention.ts).
import { CLOUD_HOME } from "../../../electron/legacy-names.mjs";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { chmodSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync, writeSync } from "node:fs";
import { join } from "node:path";

const MAGIC = Buffer.from("OMBB2\n"), LEGACY_MAGIC = Buffer.from("OMBB1\n");

/** a cloud's backup key: HKDF over this service's backup secret, bound to the cloud id */
export function homeBackupKey(secret: Buffer, cloudId: string): Buffer {
  if (secret.length < 32) throw new Error("Invalid Boat backup secret.");
  return Buffer.from(hkdfSync("sha256", secret, Buffer.from(cloudId), Buffer.from("omb-boat-backup-v2"), 32));
}
export const boatBackupKey = homeBackupKey;
const IV_BYTES = 12, TAG_BYTES = 16;
const CLOUD_ID = /^c[0-9a-f]{24}$/;
const FILE = /^(\d{13})-([a-f0-9]{8})\.ombb$/;
export const MARKER_FILE = ".omb-cloud-home.json";

export interface BackupRecord { file: string; at: number; bytes: number; sha256: string; verifiedAt: number | null }

/** the names and sizes of a tar's entries (ustar, GNU long names and pax paths), enough to tell a home's volume from anything else */
export function tarEntries(tar: Buffer): Array<{ name: string; size: number; type: string; data: Buffer }> {
  const entries: Array<{ name: string; size: number; type: string; data: Buffer }> = [];
  let offset = 0, longName: string | null = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start: number, length: number) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const sum = parseInt(field(148, 8).trim() || "0", 8);
    let check = 0;
    for (let i = 0; i < 512; i++) check += i >= 148 && i < 156 ? 32 : header[i]!;
    if (sum !== check) throw new Error("Invalid tar header.");
    const size = parseInt(field(124, 12).trim() || "0", 8), type = field(156, 1) || "0";
    const prefix = field(345, 155), data = tar.subarray(offset + 512, offset + 512 + size);
    if (data.length !== size) throw new Error("Truncated tar.");
    let name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    if (type === "L") longName = data.toString("utf8").replace(/\0.*$/s, "");
    else if (type === "x") { const path = /\d+ path=([^\n]*)\n/.exec(data.toString("utf8")); if (path) longName = path[1]!; }
    else entries.push({ name: name.replace(/^\.\//, ""), size, type, data });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/** a ustar archive of plain files (tests and the fake Boat) */
export function makeTar(files: Array<{ name: string; data: Buffer | string; mode?: number }>): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    const data = Buffer.from(file.data), header = Buffer.alloc(512);
    header.write(file.name, 0, 100, "utf8");
    header.write(`${(file.mode ?? 0o600).toString(8).padStart(7, "0")}\0`, 100);
    header.write("0000000\0", 108); header.write("0000000\0", 116);
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, "0")}\0`, 136);
    header.write("        ", 148); header.write("0", 156); header.write("ustar\0", 257); header.write("00", 263);
    let sum = 0; for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    parts.push(header, data, Buffer.alloc(Math.ceil(data.length / 512) * 512 - data.length));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

/** whether a tar is this cloud's home volume: its marker names the cloud */
export function homeVolumeProblem(tar: Buffer, cloudId: string): string | null {
  let entries;
  try { entries = tarEntries(tar); } catch { return "unreadable"; }
  const marker = entries.find(e => e.name.split("/").slice(-1)[0] === MARKER_FILE && e.name.split("/").length <= 3);
  if (!marker) return "no_marker";
  try { if ((JSON.parse(marker.data.toString("utf8")) as { machine?: unknown }).machine !== cloudId) return "other_cloud"; } catch { return "bad_marker"; }
  // a cloud home's data folder keeps its name from before the rename (CLOUD_HOME), so its backups do too
  if (!entries.some(e => e.name.split("/").slice(0, -1).includes(CLOUD_HOME.dataName))) return "no_data";
  return null;
}

export function createBackupStore(options: { dir: string; now?: () => number }) {
  const now = options.now ?? Date.now;
  mkdirSync(options.dir, { recursive: true, mode: 0o700 });
  const dirOf = (cloudId: string) => { if (!CLOUD_ID.test(cloudId)) throw new Error("Invalid cloud id."); return join(options.dir, cloudId); };
  function pathOf(cloudId: string, file: string) { if (!FILE.test(file)) throw new Error("Invalid backup name."); return join(dirOf(cloudId), file); }
  return {
    /** seals one generation; never overwrites */
    write(cloudId: string, key: Buffer, tar: Buffer): BackupRecord {
      const dir = dirOf(cloudId), at = now();
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = `${String(at).padStart(13, "0")}-${randomBytes(4).toString("hex")}.ombb`, path = join(dir, file);
      const iv = randomBytes(IV_BYTES), cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(cloudId));
      const body = Buffer.concat([cipher.update(tar), cipher.final()]), sealed = Buffer.concat([MAGIC, iv, body, cipher.getAuthTag()]);
      const fd = openSync(path, "wx", 0o600);
      try { writeSync(fd, sealed); } finally { closeSync(fd); }
      chmodSync(path, 0o400);
      return { file, at, bytes: sealed.length, sha256: createHash("sha256").update(sealed).digest("hex"), verifiedAt: null };
    },
    /** 1 for a file keyed from the home's own secret (to be sealed again), 2 for the current format */
    version(cloudId: string, file: string): 1 | 2 | null {
      const path = pathOf(cloudId, file);
      if (!existsSync(path)) return null;
      const fd = openSync(path, "r"), head = Buffer.alloc(MAGIC.length);
      try { readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
      return head.equals(MAGIC) ? 2 : head.equals(LEGACY_MAGIC) ? 1 : null;
    },
    /** opens one generation: authenticated, and bound to its cloud; `legacyKey` opens a version 1 file */
    read(cloudId: string, key: Buffer, file: string, legacyKey?: Buffer): Buffer {
      const path = pathOf(cloudId, file), fd = openSync(path, "r");
      let sealed: Buffer;
      try { const size = fstatSync(fd).size; sealed = Buffer.alloc(size); let read = 0; while (read < size) read += readSync(fd, sealed, read, size - read, read); } finally { closeSync(fd); }
      const legacy = sealed.subarray(0, LEGACY_MAGIC.length).equals(LEGACY_MAGIC);
      if (sealed.length < MAGIC.length + IV_BYTES + TAG_BYTES || !(legacy || sealed.subarray(0, MAGIC.length).equals(MAGIC))) throw new Error("Invalid backup.");
      if (legacy) { if (!legacyKey) throw new Error("Backup failed its integrity check."); key = legacyKey; }
      const iv = sealed.subarray(MAGIC.length, MAGIC.length + IV_BYTES), tag = sealed.subarray(sealed.length - TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(cloudId)); decipher.setAuthTag(tag);
      try { return Buffer.concat([decipher.update(sealed.subarray(MAGIC.length + IV_BYTES, sealed.length - TAG_BYTES)), decipher.final()]); }
      catch { throw new Error("Backup failed its integrity check."); }
    },
    sha256(cloudId: string, file: string): string | null {
      const path = pathOf(cloudId, file);
      if (!existsSync(path)) return null;
      const fd = openSync(path, "r"), hash = createHash("sha256"), chunk = Buffer.alloc(1 << 20);
      try { for (let n; (n = readSync(fd, chunk, 0, chunk.length, null)) > 0;) hash.update(chunk.subarray(0, n)); } finally { closeSync(fd); }
      return hash.digest("hex");
    },
    list(cloudId: string): string[] { const dir = dirOf(cloudId); return existsSync(dir) ? readdirSync(dir).filter(f => FILE.test(f)).sort() : []; },
    clouds(): string[] { return readdirSync(options.dir).filter(name => CLOUD_ID.test(name) && statSync(join(options.dir, name)).isDirectory()); },
    /** called only by the retention reconciler after its gate */
    remove(cloudId: string, file: string) { rmSync(pathOf(cloudId, file), { force: true }); },
  };
}
export type BackupStore = ReturnType<typeof createBackupStore>;
