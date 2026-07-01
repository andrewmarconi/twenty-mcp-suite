import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Twenty MCP Suite",
  description: "Version-resilient MCP server suite for self-hosted Twenty CRM.",
  base: "/twenty-mcp-suite/",
  cleanUrls: true,
  themeConfig: {
    search: { provider: "local" },
    nav: [
      { text: "Guide", link: "/guide/introduction" },
      { text: "Tools", link: "/tools/reference" },
      { text: "GitHub", link: "https://github.com/andrewmarconi/twenty-mcp-suite" },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Guide",
          items: [
            { text: "Introduction", link: "/guide/introduction" },
            { text: "Installation & Quickstart", link: "/guide/installation" },
            { text: "Authentication", link: "/guide/authentication" },
            { text: "Connections & multi-instance", link: "/guide/connections" },
          ],
        },
      ],
      "/tools/": [
        {
          text: "Tools",
          items: [
            { text: "Reference", link: "/tools/reference" },
            { text: "Object scoping", link: "/tools/scoping" },
            { text: "Composite reads", link: "/tools/composites" },
            { text: "Auditing", link: "/tools/auditing" },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/andrewmarconi/twenty-mcp-suite" },
    ],
  },
});
