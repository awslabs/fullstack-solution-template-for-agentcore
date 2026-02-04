// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Property-based test for authentication state routing
 * This test verifies that the application renders the correct UI based on
 * authentication state: sign-in UI for unauthenticated users and chat
 * interface for authenticated users.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import * as fc from 'fast-check'
import { render, screen, cleanup } from '@testing-library/react'
import ChatPage from '@/routes/ChatPage'

// Mock the useAuth hook
vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn()
}))

// Mock the ChatInterface component
vi.mock('@/components/chat/ChatInterface', () => ({
  default: () => <div data-testid="chat-interface">Chat Interface</div>
}))

// Mock the GlobalContextProvider
vi.mock('@/app/context/GlobalContext', () => ({
  GlobalContextProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

import { useAuth } from '@/hooks/useAuth'

describe('Authentication State Routing', () => {
  afterEach(() => {
    cleanup()
  })
  
  it('should render sign-in UI when user is not authenticated', () => {
    fc.assert(
      fc.property(
        fc.constant(false), // isAuthenticated = false
        (isAuthenticated) => {
          // Clean up before each property test iteration
          cleanup()
          
          // Mock useAuth to return unauthenticated state
          vi.mocked(useAuth).mockReturnValue({
            isAuthenticated,
            signIn: vi.fn().mockResolvedValue(undefined),
            signOut: vi.fn(),
            user: null,
            isLoading: false,
            error: undefined,
            token: undefined
          })
          
          render(<ChatPage />)
          
          // Should show "Please sign in" text
          const signInText = screen.queryByText(/Please sign in/i)
          expect(signInText).toBeTruthy()
          
          // Should show "Sign In" button
          const signInButton = screen.queryByRole('button', { name: /Sign In/i })
          expect(signInButton).toBeTruthy()
          
          // Should NOT show chat interface
          const chatInterface = screen.queryByTestId('chat-interface')
          expect(chatInterface).toBeNull()
          
          return true
        }
      ),
      { numRuns: 100 }
    )
  })
  
  it('should render chat interface when user is authenticated', () => {
    fc.assert(
      fc.property(
        fc.constant(true), // isAuthenticated = true
        (isAuthenticated) => {
          // Clean up before each property test iteration
          cleanup()
          
          // Mock useAuth to return authenticated state
          vi.mocked(useAuth).mockReturnValue({
            isAuthenticated,
            signIn: vi.fn().mockResolvedValue(undefined),
            signOut: vi.fn(),
            user: { 
              access_token: 'test-token',
              id_token: 'test-id-token',
              profile: { sub: 'test-user-id' }
            } as any,
            isLoading: false,
            error: undefined,
            token: 'test-id-token'
          })
          
          render(<ChatPage />)
          
          // Should show chat interface
          const chatInterface = screen.queryByTestId('chat-interface')
          expect(chatInterface).toBeTruthy()
          
          // Should NOT show "Please sign in" text
          const signInText = screen.queryByText(/Please sign in/i)
          expect(signInText).toBeNull()
          
          return true
        }
      ),
      { numRuns: 100 }
    )
  })
  
  it('should toggle between sign-in and chat interface based on auth state', () => {
    fc.assert(
      fc.property(
        fc.boolean(), // Random authentication state
        (isAuthenticated) => {
          // Clean up before each property test iteration
          cleanup()
          
          // Mock useAuth with the random auth state
          vi.mocked(useAuth).mockReturnValue({
            isAuthenticated,
            signIn: vi.fn().mockResolvedValue(undefined),
            signOut: vi.fn(),
            user: isAuthenticated ? { 
              access_token: 'test-token',
              id_token: 'test-id-token',
              profile: { sub: 'test-user-id' }
            } as any : null,
            isLoading: false,
            error: undefined,
            token: isAuthenticated ? 'test-id-token' : undefined
          })
          
          render(<ChatPage />)
          
          if (isAuthenticated) {
            // Should show chat interface
            const chatInterface = screen.queryByTestId('chat-interface')
            expect(chatInterface).toBeTruthy()
          } else {
            // Should show sign-in UI
            const signInText = screen.queryByText(/Please sign in/i)
            expect(signInText).toBeTruthy()
          }
          
          return true
        }
      ),
      { numRuns: 100 }
    )
  })
  
  it('should wrap authenticated view with GlobalContextProvider', () => {
    fc.assert(
      fc.property(
        fc.constant(true),
        (isAuthenticated) => {
          // Clean up before each property test iteration
          cleanup()
          
          // Mock useAuth to return authenticated state
          vi.mocked(useAuth).mockReturnValue({
            isAuthenticated,
            signIn: vi.fn().mockResolvedValue(undefined),
            signOut: vi.fn(),
            user: { 
              access_token: 'test-token',
              id_token: 'test-id-token',
              profile: { sub: 'test-user-id' }
            } as any,
            isLoading: false,
            error: undefined,
            token: 'test-id-token'
          })
          
          render(<ChatPage />)
          
          // Chat interface should be present (wrapped by GlobalContextProvider)
          const chatInterface = screen.queryByTestId('chat-interface')
          expect(chatInterface).toBeTruthy()
          
          return true
        }
      ),
      { numRuns: 100 }
    )
  })
  
  it('should provide signIn function in unauthenticated state', () => {
    fc.assert(
      fc.property(
        fc.constant(false),
        (isAuthenticated) => {
          // Clean up before each property test iteration
          cleanup()
          
          const mockSignIn = vi.fn()
          
          // Mock useAuth with signIn function
          vi.mocked(useAuth).mockReturnValue({
            isAuthenticated,
            signIn: mockSignIn,
            signOut: vi.fn(),
            user: null,
            isLoading: false,
            error: undefined,
            token: undefined
          })
          
          render(<ChatPage />)
          
          // Sign In button should be present
          const signInButton = screen.queryByRole('button', { name: /Sign In/i })
          expect(signInButton).toBeTruthy()
          
          // Click the button
          signInButton?.click()
          
          // signIn function should have been called
          expect(mockSignIn).toHaveBeenCalled()
          
          return true
        }
      ),
      { numRuns: 100 }
    )
  })
})
