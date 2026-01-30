// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('Component Integration Tests', () => {
  describe('App Component Structure', () => {
    it('should import BrowserRouter from react-router-dom', () => {
      const appContent = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8')
      expect(appContent).toContain('import { BrowserRouter } from \'react-router-dom\'')
    })

    it('should import AuthProvider', () => {
      const appContent = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8')
      expect(appContent).toContain('import { AuthProvider } from \'@/components/auth/AuthProvider\'')
    })

    it('should wrap routes with BrowserRouter', () => {
      const appContent = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8')
      expect(appContent).toContain('<BrowserRouter>')
      expect(appContent).toContain('</BrowserRouter>')
    })

    it('should wrap routes with AuthProvider', () => {
      const appContent = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8')
      expect(appContent).toContain('<AuthProvider>')
      expect(appContent).toContain('</AuthProvider>')
    })

    it('should render AppRoutes component', () => {
      const appContent = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8')
      expect(appContent).toContain('<AppRoutes />')
    })
  })

  describe('AuthProvider Component', () => {
    it('should use react-oidc-context AuthProvider', () => {
      const authProviderContent = readFileSync(resolve(__dirname, '../components/auth/AuthProvider.tsx'), 'utf-8')
      expect(authProviderContent).toContain('import { AuthProvider as OidcAuthProvider } from "react-oidc-context"')
    })

    it('should load auth configuration', () => {
      const authProviderContent = readFileSync(resolve(__dirname, '../components/auth/AuthProvider.tsx'), 'utf-8')
      expect(authProviderContent).toContain('createCognitoAuthConfig')
    })

    it('should show loading state while loading config', () => {
      const authProviderContent = readFileSync(resolve(__dirname, '../components/auth/AuthProvider.tsx'), 'utf-8')
      expect(authProviderContent).toContain('Loading authentication configuration')
    })

    it('should handle auth config loading errors', () => {
      const authProviderContent = readFileSync(resolve(__dirname, '../components/auth/AuthProvider.tsx'), 'utf-8')
      expect(authProviderContent).toContain('Failed to load authentication configuration')
    })

    it('should wrap children with OidcAuthProvider', () => {
      const authProviderContent = readFileSync(resolve(__dirname, '../components/auth/AuthProvider.tsx'), 'utf-8')
      expect(authProviderContent).toContain('<OidcAuthProvider')
      expect(authProviderContent).toContain('</OidcAuthProvider>')
    })
  })

  describe('ChatPage Component', () => {
    it('should use useAuth hook', () => {
      const chatPageContent = readFileSync(resolve(__dirname, '../routes/ChatPage.tsx'), 'utf-8')
      expect(chatPageContent).toContain('import { useAuth } from "@/hooks/useAuth"')
      expect(chatPageContent).toContain('const { isAuthenticated, signIn } = useAuth()')
    })

    it('should render sign-in UI for unauthenticated users', () => {
      const chatPageContent = readFileSync(resolve(__dirname, '../routes/ChatPage.tsx'), 'utf-8')
      expect(chatPageContent).toContain('if (!isAuthenticated)')
      expect(chatPageContent).toContain('Please sign in')
      expect(chatPageContent).toContain('Sign In')
    })

    it('should render ChatInterface for authenticated users', () => {
      const chatPageContent = readFileSync(resolve(__dirname, '../routes/ChatPage.tsx'), 'utf-8')
      expect(chatPageContent).toContain('import ChatInterface from "@/components/chat/ChatInterface"')
      expect(chatPageContent).toContain('<ChatInterface />')
    })

    it('should wrap authenticated view with GlobalContextProvider', () => {
      const chatPageContent = readFileSync(resolve(__dirname, '../routes/ChatPage.tsx'), 'utf-8')
      expect(chatPageContent).toContain('import { GlobalContextProvider } from "@/app/context/GlobalContext"')
      expect(chatPageContent).toContain('<GlobalContextProvider>')
      expect(chatPageContent).toContain('</GlobalContextProvider>')
    })
  })

  describe('Route Configuration', () => {
    it('should define routes using react-router-dom', () => {
      const routesContent = readFileSync(resolve(__dirname, '../routes/index.tsx'), 'utf-8')
      expect(routesContent).toContain('import { Routes, Route } from \'react-router-dom\'')
    })

    it('should have root route pointing to ChatPage', () => {
      const routesContent = readFileSync(resolve(__dirname, '../routes/index.tsx'), 'utf-8')
      expect(routesContent).toContain('<Route path="/" element={<ChatPage />} />')
    })

    it('should import ChatPage component', () => {
      const routesContent = readFileSync(resolve(__dirname, '../routes/index.tsx'), 'utf-8')
      expect(routesContent).toContain('import ChatPage from \'./ChatPage\'')
    })
  })
})
