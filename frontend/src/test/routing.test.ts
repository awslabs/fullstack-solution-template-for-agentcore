// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('Routing Tests', () => {
  describe('Route Configuration', () => {
    it('should use react-router-dom Routes component', () => {
      const routesContent = readFileSync(resolve(__dirname, '../routes/index.tsx'), 'utf-8')
      expect(routesContent).toContain('import { Routes, Route } from \'react-router-dom\'')
      expect(routesContent).toContain('<Routes>')
      expect(routesContent).toContain('</Routes>')
    })

    it('should export AppRoutes as default', () => {
      const routesContent = readFileSync(resolve(__dirname, '../routes/index.tsx'), 'utf-8')
      expect(routesContent).toContain('export default function AppRoutes()')
    })
  })

  describe('BrowserRouter Configuration', () => {
    it('should use BrowserRouter in App component', () => {
      const appContent = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8')
      expect(appContent).toContain('import { BrowserRouter } from \'react-router-dom\'')
      expect(appContent).toContain('<BrowserRouter>')
      expect(appContent).toContain('</BrowserRouter>')
    })

    it('should wrap entire app with BrowserRouter', () => {
      const appContent = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8')
      
      // BrowserRouter should be the outermost component
      const browserRouterIndex = appContent.indexOf('<BrowserRouter>')
      const authProviderIndex = appContent.indexOf('<AuthProvider>')
      
      expect(browserRouterIndex).toBeGreaterThan(0)
      expect(authProviderIndex).toBeGreaterThan(browserRouterIndex)
    })

    it('should render AppRoutes inside BrowserRouter', () => {
      const appContent = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8')
      expect(appContent).toContain('import AppRoutes from \'./routes\'')
      expect(appContent).toContain('<AppRoutes />')
    })
  })

  describe('Route Structure', () => {
    it('should have routes directory with index.tsx', () => {
      const routesContent = readFileSync(resolve(__dirname, '../routes/index.tsx'), 'utf-8')
      expect(routesContent).toBeTruthy()
    })
  })


  describe('Route Component Integration', () => {
    it('should integrate routes with authentication', () => {
      const appContent = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8')
      
      // Routes should be wrapped with AuthProvider
      const authProviderIndex = appContent.indexOf('<AuthProvider>')
      const appRoutesIndex = appContent.indexOf('<AppRoutes />')
      
      expect(authProviderIndex).toBeGreaterThan(0)
      expect(appRoutesIndex).toBeGreaterThan(authProviderIndex)
    })

    it('should have proper component hierarchy', () => {
      const appContent = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8')
      
      // Hierarchy: BrowserRouter > AuthProvider > AppRoutes
      const browserRouterIndex = appContent.indexOf('<BrowserRouter>')
      const authProviderIndex = appContent.indexOf('<AuthProvider>')
      const appRoutesIndex = appContent.indexOf('<AppRoutes />')
      
      expect(browserRouterIndex).toBeLessThan(authProviderIndex)
      expect(authProviderIndex).toBeLessThan(appRoutesIndex)
    })
  })
})
