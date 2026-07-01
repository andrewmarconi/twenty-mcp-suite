import { randomBytes } from "node:crypto";
import type { TokenStore } from "./tokenStore.js";
import { generateCodeVerifier, codeChallengeS256 } from "./pkce.js";
import { registerClient, exchangeCode, buildAuthorizeUrl, DEFAULT_TOKEN_TTL_SECONDS } from "./oauthClient.js";
import { startLoopback, openBrowser } from "./loopback.js";

export interface LoginDeps {
  register: typeof registerClient;
  exchange: typeof exchangeCode;
  startLoopback: typeof startLoopback;
  openBrowser: typeof openBrowser;
  generateVerifier: () => string;
  challenge: (verifier: string) => string;
  makeState: () => string;
  log: (msg: string) => void;
}

const DEFAULT_PORT = 52333;

function defaultDeps(): LoginDeps {
  return {
    register: registerClient,
    exchange: exchangeCode,
    startLoopback,
    openBrowser,
    generateVerifier: generateCodeVerifier,
    challenge: codeChallengeS256,
    makeState: () => randomBytes(16).toString("base64url"),
    // CLI-only orchestration: stdout is fine here (not the MCP server).
    log: (msg) => console.log(msg),
  };
}

export async function loginConnection(
  args: { label: string; baseUrl: string; store: TokenStore; port?: number },
  deps: LoginDeps = defaultDeps(),
): Promise<void> {
  const port = args.port ?? DEFAULT_PORT;
  const existing = await args.store.get(args.label);
  let server;
  try {
    server = await deps.startLoopback(port);
  } catch (e) {
    if ((e as { code?: string })?.code === "EADDRINUSE") {
      throw new Error(`Local port ${port} is already in use — another sign-in may be running. Try again in a moment.`);
    }
    throw e;
  }
  try {
    let clientId = existing?.clientId;
    let clientSecret = existing?.clientSecret;
    if (!clientId || !clientSecret) {
      const creds = await deps.register(args.baseUrl, server.redirectUri, undefined);
      clientId = creds.clientId;
      clientSecret = creds.clientSecret;
    }

    const verifier = deps.generateVerifier();
    const challenge = deps.challenge(verifier);
    const state = deps.makeState();
    const authorizeUrl = buildAuthorizeUrl({
      baseUrl: args.baseUrl,
      clientId,
      redirectUri: server.redirectUri,
      state,
      codeChallenge: challenge,
    });

    deps.log(`Opening your browser to sign in. If it does not open, visit:\n${authorizeUrl}`);
    deps.openBrowser(authorizeUrl);

    const code = await server.waitForCode(state);
    const tokens = await deps.exchange(
      {
        baseUrl: args.baseUrl,
        clientId,
        clientSecret,
        code,
        redirectUri: server.redirectUri,
        codeVerifier: verifier,
      },
      undefined,
    );

    await args.store.set(args.label, {
      clientId,
      clientSecret,
      refreshToken: tokens.refreshToken ?? "",
      accessToken: tokens.accessToken,
      expiresAt: Date.now() + (tokens.expiresIn ?? DEFAULT_TOKEN_TTL_SECONDS) * 1000,
    });
    deps.log(`Signed in to "${args.label}".`);
  } finally {
    server.close();
  }
}
