import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TokenRecord {
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;
}

export interface TokenStore {
  get(label: string): Promise<TokenRecord | null>;
  set(label: string, rec: TokenRecord): Promise<void>;
  delete(label: string): Promise<void>;
  labels(): Promise<string[]>;
}

interface Blob {
  iv: string;
  tag: string;
  ct: string;
}

export function defaultConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "twenty-mcp");
}

export interface FileTokenStoreOptions {
  /** Break locks whose mtime is older than this (holder crashed). Default 10s. */
  lockStaleMs?: number;
  /** Give up waiting for the lock after this long. Default 5s. */
  lockTimeoutMs?: number;
  /** Sleep between acquire attempts. Default 25ms. */
  lockRetryMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class FileTokenStore implements TokenStore {
  private readonly keyPath: string;
  private readonly dataPath: string;
  private readonly lockPath: string;
  private readonly lockStaleMs: number;
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly dir: string,
    opts: FileTokenStoreOptions = {},
  ) {
    this.keyPath = join(dir, "store.key");
    this.dataPath = join(dir, "tokens.json");
    this.lockPath = join(dir, "tokens.json.lock");
    this.lockStaleMs = opts.lockStaleMs ?? 10_000;
    this.lockTimeoutMs = opts.lockTimeoutMs ?? 5_000;
    this.lockRetryMs = opts.lockRetryMs ?? 25;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async get(label: string): Promise<TokenRecord | null> {
    const all = this.readAll();
    const blob = all[label];
    if (!blob) return null;
    return JSON.parse(this.decrypt(blob)) as TokenRecord;
  }

  async set(label: string, rec: TokenRecord): Promise<void> {
    await this.withLock(() => {
      const all = this.readAll();
      all[label] = this.encrypt(JSON.stringify(rec));
      this.writeAll(all);
    });
  }

  async delete(label: string): Promise<void> {
    await this.withLock(() => {
      const all = this.readAll();
      delete all[label];
      this.writeAll(all);
    });
  }

  async labels(): Promise<string[]> {
    return Object.keys(this.readAll());
  }

  private async acquireLock(): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      try {
        writeFileSync(this.lockPath, String(process.pid), { flag: "wx", mode: 0o600 });
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      let mtimeMs: number;
      try {
        mtimeMs = statSync(this.lockPath).mtimeMs;
      } catch {
        continue; // lock vanished between attempts — retry immediately
      }
      if (Date.now() - mtimeMs > this.lockStaleMs) {
        try {
          unlinkSync(this.lockPath); // holder crashed — break the stale lock
        } catch {
          /* another process broke it first */
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `twenty-mcp: timed out waiting for the token-store lock at ${this.lockPath}. ` +
            `If no other twenty-mcp process is running, delete the lock file and retry.`,
        );
      }
      await this.sleep(this.lockRetryMs);
    }
  }

  private releaseLock(): void {
    try {
      unlinkSync(this.lockPath);
    } catch {
      /* already gone */
    }
  }

  private async withLock<T>(fn: () => T): Promise<T> {
    await this.acquireLock();
    try {
      return fn();
    } finally {
      this.releaseLock();
    }
  }

  private key(): Buffer {
    mkdirSync(this.dir, { recursive: true });
    if (!existsSync(this.keyPath)) {
      writeFileSync(this.keyPath, randomBytes(32), { mode: 0o600 });
    }
    const key = readFileSync(this.keyPath);
    if (key.length !== 32) {
      throw new Error(
        `twenty-mcp: key file at ${this.keyPath} is not a valid 32-byte key. ` +
          `Delete it and re-authenticate (this will invalidate any stored tokens), ` +
          `or restore the original key file.`,
      );
    }
    return key;
  }

  private encrypt(plaintext: string): Blob {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key(), iv);
    const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ct: ct.toString("base64"),
    };
  }

  private decrypt(blob: Blob): string {
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(blob.iv, "base64"));
      decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(blob.ct, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch (err) {
      throw new Error(
        `twenty-mcp: token store record is corrupt or was tampered with, or the key file changed. ` +
          `Run 'twenty-mcp logout <label>' to remove it and re-authenticate.`,
        { cause: err },
      );
    }
  }

  private readAll(): Record<string, Blob> {
    if (!existsSync(this.dataPath)) return {};
    const raw = readFileSync(this.dataPath, "utf8");
    try {
      return JSON.parse(raw) as Record<string, Blob>;
    } catch (err) {
      throw new Error(
        `twenty-mcp: token store at ${this.dataPath} is corrupt (invalid JSON). ` +
          `Delete the file and re-authenticate, or run 'twenty-mcp logout <label>'.`,
        { cause: err },
      );
    }
  }

  private writeAll(all: Record<string, Blob>): void {
    mkdirSync(this.dir, { recursive: true });
    // Write-then-rename: same-directory rename is atomic, so readers never
    // observe a torn tokens.json, and 0600 is re-asserted on every write.
    const tmp = join(this.dir, `tokens.json.tmp-${process.pid}-${randomBytes(4).toString("hex")}`);
    writeFileSync(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
    renameSync(tmp, this.dataPath);
  }
}
