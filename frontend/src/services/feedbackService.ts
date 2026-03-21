/**
 * Feedback Service
 * Handles submission of user feedback to the backend API
 */

import { loadAwsConfig } from "@/lib/runtime-config"

// Load API URL from aws-exports.json
let FEEDBACK_API_URL = ""

// Dynamically load the API URL from aws-exports.json
async function loadApiUrl(): Promise<string> {
  if (FEEDBACK_API_URL) {
    return FEEDBACK_API_URL
  }

  try {
    const config = await loadAwsConfig()
    if (!config) {
      throw new Error("Feedback API URL not configured")
    }
    FEEDBACK_API_URL = config.feedbackApiUrl ? `${config.feedbackApiUrl}feedback` : ""
    return FEEDBACK_API_URL
  } catch (error) {
    console.error("Failed to load API URL from aws-exports.json:", error)
    throw new Error("Feedback API URL not configured")
  }
}

export interface FeedbackPayload {
  sessionId: string
  message: string
  feedbackType: "positive" | "negative"
  comment?: string
}

export interface FeedbackResponse {
  success: boolean
  feedbackId: string
}

/**
 * Submit feedback to the backend API
 *
 * @param payload - Feedback data in camelCase format
 * @param idToken - Cognito ID token for authentication (required by API Gateway Cognito authorizer)
 * @returns Promise with feedback response
 */
export async function submitFeedback(
  payload: FeedbackPayload,
  idToken: string
): Promise<FeedbackResponse> {
  try {
    // Load the API URL dynamically
    const apiUrl = await loadApiUrl()

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`)
    }

    const data: FeedbackResponse = await response.json()
    return data
  } catch (error) {
    console.error("Error submitting feedback:", error)
    throw error
  }
}
