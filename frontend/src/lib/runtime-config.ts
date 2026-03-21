import type { WebStorageStateStore } from "oidc-client-ts"

export type AwsExportsConfig = {
  authority?: string
  client_id?: string
  redirect_uri?: string
  post_logout_redirect_uri?: string
  response_type?: string
  scope?: string
  automaticSilentRenew?: boolean
  agentRuntimeArn?: string
  awsRegion?: string
  feedbackApiUrl?: string
  copilotKitRuntimeUrl?: string
  agentPattern?: string
  userStore?: WebStorageStateStore
}

let configCache: AwsExportsConfig | null = null
let configPromise: Promise<AwsExportsConfig | null> | null = null

export async function loadAwsConfig(): Promise<AwsExportsConfig | null> {
  if (configCache) {
    return configCache
  }

  if (configPromise) {
    return configPromise
  }

  configPromise = (async () => {
    try {
      const response = await fetch("/aws-exports.json")
      if (!response.ok) {
        throw new Error(`Failed to load aws-exports.json: ${response.status}`)
      }

      const config = (await response.json()) as AwsExportsConfig
      configCache = config
      return config
    } catch (error) {
      console.error("Failed to load aws-exports.json:", error)
      throw error
    }
  })()

  return configPromise
}
