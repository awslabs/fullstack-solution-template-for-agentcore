// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "path"
import { viteStaticCopy } from "vite-plugin-static-copy"

// Path to the vendored DCV SDK inside bedrock-agentcore
const dcvSdkDir = path.resolve(
  __dirname,
  "node_modules/bedrock-agentcore/dist/src/tools/browser/live-view/nice-dcv-web-client-sdk"
)

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: path.resolve(dcvSdkDir, "dcvjs-esm"), dest: "nice-dcv-web-client-sdk" },
        { src: path.resolve(dcvSdkDir, "dcv-ui"), dest: "nice-dcv-web-client-sdk" },
      ],
    }),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // DCV SDK bare specifier aliases — required for BrowserLiveView
      dcv: path.resolve(dcvSdkDir, "dcvjs-esm/dcv.js"),
      "dcv-ui": path.resolve(dcvSdkDir, "dcv-ui/dcv-ui.js"),
    },
    // Force shared deps to resolve from this project's node_modules,
    // not from the vendored SDK path
    dedupe: [
      "react",
      "react-dom",
      "prop-types",
      "@cloudscape-design/components",
      "@cloudscape-design/global-styles",
      "@cloudscape-design/design-tokens",
      "@babel/runtime",
    ],
  },

  build: {
    outDir: "build",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "ui-vendor": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-select",
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-progress",
          ],
          "auth-vendor": ["react-oidc-context", "aws-amplify"],
        },
      },
    },
  },

  server: {
    port: 3000,
    open: true,
  },
})
