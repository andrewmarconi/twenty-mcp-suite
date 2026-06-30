export interface TwentyConfig {
  baseUrl: string;
  apiKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): TwentyConfig {
  const baseUrl = env.TWENTY_BASE_URL?.trim();
  const apiKey = env.TWENTY_API_KEY?.trim();

  if (!baseUrl) {
    throw new Error(
      "TWENTY_BASE_URL is not set. Set it to your Twenty instance URL, e.g. https://crm.example.com",
    );
  }
  if (!apiKey) {
    throw new Error(
      "TWENTY_API_KEY is not set. Create an API key in Twenty under Settings > APIs & Webhooks.",
    );
  }

  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}
