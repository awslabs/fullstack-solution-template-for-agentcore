// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { resolve, join } from 'path'

describe('Build Output Tests', () => {
  const buildDir = resolve(__dirname, '../../build')

  describe('Build Directory', () => {
    it('should have build directory', () => {
      expect(existsSync(buildDir)).toBe(true)
    })

    it('should contain index.html at root', () => {
      const indexPath = join(buildDir, 'index.html')
      expect(existsSync(indexPath)).toBe(true)
    })

    it('should have assets directory', () => {
      const assetsPath = join(buildDir, 'assets')
      expect(existsSync(assetsPath)).toBe(true)
    })
  })

  describe('Index HTML', () => {
    it('should have valid HTML structure', () => {
      const indexPath = join(buildDir, 'index.html')
      if (existsSync(indexPath)) {
        const content = readFileSync(indexPath, 'utf-8')
        expect(content).toContain('<!DOCTYPE html>')
        expect(content).toContain('<html')
        expect(content).toContain('<head>')
        expect(content).toContain('<body>')
        expect(content).toContain('<div id="root">')
      }
    })

    it('should reference bundled JavaScript files', () => {
      const indexPath = join(buildDir, 'index.html')
      if (existsSync(indexPath)) {
        const content = readFileSync(indexPath, 'utf-8')
        // Should have script tags with module type
        expect(content).toMatch(/<script[^>]*type="module"[^>]*>/i)
      }
    })

    it('should reference bundled CSS files', () => {
      const indexPath = join(buildDir, 'index.html')
      if (existsSync(indexPath)) {
        const content = readFileSync(indexPath, 'utf-8')
        // Should have link tags for stylesheets
        expect(content).toMatch(/<link[^>]*rel="stylesheet"[^>]*>/i)
      }
    })
  })

  describe('Asset Files', () => {
    it('should contain JavaScript files', () => {
      const assetsPath = join(buildDir, 'assets')
      if (existsSync(assetsPath)) {
        const files = readdirSync(assetsPath)
        const jsFiles = files.filter(f => f.endsWith('.js'))
        expect(jsFiles.length).toBeGreaterThan(0)
      }
    })

    it('should contain CSS files', () => {
      const assetsPath = join(buildDir, 'assets')
      if (existsSync(assetsPath)) {
        const files = readdirSync(assetsPath)
        const cssFiles = files.filter(f => f.endsWith('.css'))
        expect(cssFiles.length).toBeGreaterThan(0)
      }
    })

    it('should have minified JavaScript files', () => {
      const assetsPath = join(buildDir, 'assets')
      if (existsSync(assetsPath)) {
        const files = readdirSync(assetsPath)
        const jsFiles = files.filter(f => f.endsWith('.js') && !f.endsWith('.map'))
        
        if (jsFiles.length > 0) {
          const sampleFile = join(assetsPath, jsFiles[0])
          const content = readFileSync(sampleFile, 'utf-8')
          // Minified files typically have no newlines or very few
          const lineCount = content.split('\n').length
          expect(lineCount).toBeLessThan(10) // Minified files should have very few lines
        }
      }
    })

    it('should have minified CSS files', () => {
      const assetsPath = join(buildDir, 'assets')
      if (existsSync(assetsPath)) {
        const files = readdirSync(assetsPath)
        const cssFiles = files.filter(f => f.endsWith('.css') && !f.endsWith('.map'))
        
        if (cssFiles.length > 0) {
          const sampleFile = join(assetsPath, cssFiles[0])
          const content = readFileSync(sampleFile, 'utf-8')
          // Minified CSS should have minimal whitespace
          expect(content).not.toMatch(/\n\s+/g) // Should not have indented lines
        }
      }
    })
  })

  describe('Source Maps', () => {
    it('should generate JavaScript source maps', () => {
      const assetsPath = join(buildDir, 'assets')
      if (existsSync(assetsPath)) {
        const files = readdirSync(assetsPath)
        const mapFiles = files.filter(f => f.endsWith('.js.map'))
        expect(mapFiles.length).toBeGreaterThan(0)
      }
    })

    it('should have valid source map structure', () => {
      const assetsPath = join(buildDir, 'assets')
      if (existsSync(assetsPath)) {
        const files = readdirSync(assetsPath)
        const mapFiles = files.filter(f => f.endsWith('.js.map'))
        
        if (mapFiles.length > 0) {
          const mapFile = join(assetsPath, mapFiles[0])
          const content = readFileSync(mapFile, 'utf-8')
          const sourceMap = JSON.parse(content)
          
          // Valid source maps should have these properties
          expect(sourceMap).toHaveProperty('version')
          expect(sourceMap).toHaveProperty('sources')
          expect(sourceMap).toHaveProperty('mappings')
        }
      }
    })
  })

  describe('Code Splitting', () => {
    it('should create multiple JavaScript chunks', () => {
      const assetsPath = join(buildDir, 'assets')
      if (existsSync(assetsPath)) {
        const files = readdirSync(assetsPath)
        const jsFiles = files.filter(f => f.endsWith('.js') && !f.endsWith('.map'))
        // Should have multiple chunks due to code splitting
        expect(jsFiles.length).toBeGreaterThan(1)
      }
    })

    it('should have vendor chunks for libraries', () => {
      const assetsPath = join(buildDir, 'assets')
      if (existsSync(assetsPath)) {
        const files = readdirSync(assetsPath)
        const jsFiles = files.filter(f => f.endsWith('.js') && !f.endsWith('.map'))
        
        // Check if there are multiple chunks (indicating code splitting)
        // The exact naming depends on Vite's chunking strategy
        expect(jsFiles.length).toBeGreaterThanOrEqual(2)
      }
    })
  })

  describe('Static Assets', () => {
    it('should copy public assets to build directory', () => {
      const faviconPath = join(buildDir, 'favicon.ico')
      expect(existsSync(faviconPath)).toBe(true)
    })

    it('should preserve public asset structure', () => {
      // Check that public assets are at the root of build, not in a subdirectory
      const faviconPath = join(buildDir, 'favicon.ico')
      if (existsSync(faviconPath)) {
        const stats = statSync(faviconPath)
        expect(stats.isFile()).toBe(true)
      }
    })
  })

  describe('Build Optimization', () => {
    it('should produce optimized bundle sizes', () => {
      const assetsPath = join(buildDir, 'assets')
      if (existsSync(assetsPath)) {
        const files = readdirSync(assetsPath)
        const jsFiles = files.filter(f => f.endsWith('.js') && !f.endsWith('.map'))
        
        // Check that individual chunks are reasonably sized (not too large)
        jsFiles.forEach(file => {
          const filePath = join(assetsPath, file)
          const stats = statSync(filePath)
          // Individual chunks should typically be under 1MB for good performance
          expect(stats.size).toBeLessThan(1024 * 1024) // 1MB
        })
      }
    })
  })
})
