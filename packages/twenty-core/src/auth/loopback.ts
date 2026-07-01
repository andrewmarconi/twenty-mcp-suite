import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { platform } from "node:os";

export function parseCallback(reqUrl: string): {
  code?: string;
  state?: string;
  error?: string;
} {
  const u = new URL(reqUrl, "http://localhost");
  const out: { code?: string; state?: string; error?: string } = {};
  const error = u.searchParams.get("error");
  if (error) out.error = error;
  const code = u.searchParams.get("code");
  if (code) out.code = code;
  const state = u.searchParams.get("state");
  if (state) out.state = state;
  return out;
}

export interface LoopbackServer {
  redirectUri: string;
  waitForCode(expectedState: string): Promise<string>;
  close(): void;
}

export function startLoopback(port: number): Promise<LoopbackServer> {
  return new Promise((resolve, reject) => {
    let onResult: ((r: { code?: string; state?: string; error?: string }) => void) | null = null;

    const server: Server = createServer((req, res) => {
      const result = parseCallback(req.url ?? "");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>Sign-in complete. You can close this tab.</body></html>");
      onResult?.(result);
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        redirectUri: `http://localhost:${port}/callback`,
        waitForCode(expectedState: string): Promise<string> {
          return new Promise((res, rej) => {
            onResult = (r) => {
              if (r.error) return rej(new Error(`OAuth error: ${r.error}`));
              if (!r.code) return; // ignore stray requests (favicon, etc.)
              if (r.state !== expectedState) return rej(new Error("OAuth state mismatch"));
              res(r.code);
            };
          });
        },
        close: () => server.close(),
      });
    });
  });
}

export function openBrowser(url: string): void {
  const cmd =
    platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true, shell: platform() === "win32" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Non-fatal: the CLI also prints the URL for manual opening.
  }
}
