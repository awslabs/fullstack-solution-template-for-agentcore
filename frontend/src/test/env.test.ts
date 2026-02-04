// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('Environment Variable Tests', () => {
  describe('Auth Configuration', () => {
    it('should use import.meta.env instead of process.env', () => {
      const authContent = readFileSync(resolve(__dirname, '../lib/auth.ts'), 'utf-8')
      
      // Should use import.meta.env
      expect(authContent).toContain('import.meta.env')
      
      // Should NOT use process.env
      expect(authContent).not.toContain('process.env')
    })

    it('should use VITE_ prefix for environment variables', () => {
      const authContent = readFileSync(resolve(__dirname, '../lib/auth.ts'), 'utf-8')
      
      // Check for VITE_ prefixed variables
      expect(authContent).toContain('VITE_COGNITO_USER_POOL_ID')
      expect(authContent).toContain('VITE_COGNITO_CLIENT_ID')
      expect(authContent).toContain('VITE_COGNITO_REGION')
      expect(authContent).toContain('VITE_COGNITO_REDIRECT_URI')
      expect(authContent).toContain('VITE_COGNITO_POST_LOGOUT_REDIRECT_URI')
      expect(authContent).toContain('VITE_COGNITO_RESPONSE_TYPE')
      expect(authContent).toContain('VITE_COGNITO_SCOPE')
      expect(authContent).toContain('VITE_COGNITO_AUTOMATIC_SILENT_RENEW')
    })

    it('should NOT use NEXT_PUBLIC_ prefix', () => {
      const authContent = readFileSync(resolve(__dirname, '../lib/auth.ts'), 'utf-8')
      
      // Should NOT have NEXT_PUBLIC_ prefix
      expect(authContent).not.toContain('NEXT_PUBLIC_')
    })

    it('should have fallback to aws-exports.json', () => {
      const authContent = readFileSync(resolve(__dirname, '../lib/auth.ts'), 'utf-8')
      
      // Should load aws-exports.json as fallback
      expect(authContent).toContain('aws-exports.json')
      expect(authContent).toContain('loadAwsConfig')
    })

    it('should handle missing environment variables gracefully', () => {
      const authContent = readFileSync(resolve(__dirname, '../lib/auth.ts'), 'utf-8')
      
      // Should have fallback logic using || operator
      expect(authContent).toMatch(/\|\|.*awsConfig/)
    })
  })

  describe('Environment Variable Type Definitions', () => {
    it('should have vite-env.d.ts with environment variable types', () => {
      const viteEnvPath = resolve(__dirname, '../vite-env.d.ts')
      const viteEnvContent = readFileSync(viteEnvPath, 'utf-8')
      
      // Should reference vite/client types
      expect(viteEnvContent).toContain('/// <reference types="vite/client" />')
    })

    it('should define ImportMetaEnv interface', () => {
      const viteEnvPath = resolve(__dirname, '../vite-env.d.ts')
      const viteEnvContent = readFileSync(viteEnvPath, 'utf-8')
      
      // Should define ImportMetaEnv interface
      expect(viteEnvContent).toContain('interface ImportMetaEnv')
    })

    it('should define Cognito environment variable types', () => {
      const viteEnvPath = resolve(__dirname, '../vite-env.d.ts')
      const viteEnvContent = readFileSync(viteEnvPath, 'utf-8')
      
      // Should have Cognito variable types
      expect(viteEnvContent).toContain('VITE_COGNITO_USER_POOL_ID')
      expect(viteEnvContent).toContain('VITE_COGNITO_CLIENT_ID')
      expect(viteEnvContent).toContain('VITE_COGNITO_REGION')
    })
  })

  describe('Codebase-wide Environment Variable Usage', () => {
    it('should not have any process.env usage in source files', () => {
      // Check key source files for process.env usage
      const filesToCheck = [
        '../lib/auth.ts',
        '../App.tsx',
        '../main.tsx',
      ]

      filesToCheck.forEach(file => {
        const content = readFileSync(resolve(__dirname, file), 'utf-8')
        expect(content).not.toContain('process.env')
      })
    })

    it('should not have any NEXT_PUBLIC_ prefix in source files', () => {
      // Check key source files for NEXT_PUBLIC_ usage
      const filesToCheck = [
        '../lib/auth.ts',
        '../App.tsx',
        '../main.tsx',
      ]

      filesToCheck.forEach(file => {
        const content = readFileSync(resolve(__dirname, file), 'utf-8')
        expect(content).not.toContain('NEXT_PUBLIC_')
      })
    })
  })

  describe('Configuration Priority', () => {
    it('should prioritize environment variables over aws-exports.json', () => {
      const authContent = readFileSync(resolve(__dirname, '../lib/auth.ts'), 'utf-8')
      
      // Should use env vars first, then fall back to awsConfig
      // Pattern: envVar || awsConfig.property
      expect(authContent).toContain('clientId || awsConfig.client_id')
      expect(authContent).toContain('redirectUri || awsConfig.redirect_uri')
    })

    it('should have default values for some configuration', () => {
      const authContent = readFileSync(resolve(__dirname, '../lib/auth.ts'), 'utf-8')
      
      // Should have default values for response_type and scope
      expect(authContent).toContain('"code"')
      expect(authContent).toContain('email openid profile')
    })
  })

  describe('Runtime Configuration Loading', () => {
    it('should load aws-exports.json at runtime', () => {
      const authContent = readFileSync(resolve(__dirname, '../lib/auth.ts'), 'utf-8')
      
      // Should fetch aws-exports.json
      expect(authContent).toContain('fetch("/aws-exports.json")')
    })

    it('should handle aws-exports.json loading errors', () => {
      const authContent = readFileSync(resolve(__dirname, '../lib/auth.ts'), 'utf-8')
      
      // Should have error handling
      expect(authContent).toContain('catch')
      expect(authContent).toContain('Failed to load aws-exports.json')
    })

    it('should cache loaded configuration', () => {
      const authContent = readFileSync(resolve(__dirname, '../lib/auth.ts'), 'utf-8')
      
      // Should have caching mechanism
      expect(authContent).toContain('configCache')
    })
  })
})
