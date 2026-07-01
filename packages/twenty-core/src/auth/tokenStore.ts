import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TokenRecord {
  clientId: string;
  clientSecret: string;
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

export class FileTokenStore implements TokenStore {
  private readonly keyPath: string;
  private readonly dataPath: string;

  constructor(private readonly dir: string) {
    this.keyPath = join(dir, "store.key");
    this.dataPath = join(dir, "tokens.json");
  }

  async get(label: string): Promise<TokenRecord | null> {
    const all = this.readAll();
    const blob = all[label];
    if (!blob) return null;
    return JSON.parse(this.decrypt(blob)) as TokenRecord;
  }

  async set(label: string, rec: TokenRecord): Promise<void> {
    const all = this.readAll();
    all[label] = this.encrypt(JSON.stringify(rec));
    this.writeAll(all);
  }

  async delete(label: string): Promise<void> {
    const all = this.readAll();
    delete all[label];
    this.writeAll(all);
  }

  async labels(): Promise<string[]> {
    return Object.keys(this.readAll());
  }

  private key(): Buffer {
    mkdirSync(this.dir, { recursive: true });
    if (!existsSync(this.keyPath)) {
      writeFileSync(this.keyPath, randomBytes(32), { mode: 0o600 });
    }
    return readFileSync(this.keyPath);
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
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key(),
      Buffer.from(blob.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(blob.ct, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }

  private readAll(): Record<string, Blob> {
    if (!existsSync(this.dataPath)) return {};
    return JSON.parse(readFileSync(this.dataPath, "utf8")) as Record<string, Blob>;
  }

  private writeAll(all: Record<string, Blob>): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.dataPath, JSON.stringify(all, null, 2), { mode: 0o600 });
  }
}
