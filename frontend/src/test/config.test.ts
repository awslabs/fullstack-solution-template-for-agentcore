// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Helper function to parse JSONC (JSON with comments)
 * Strips single-line and multi-line comments before parsing
 */
function parseJSONC(content: string): any {
  // Remove single-line comments
  let cleaned = content.replace(/\/\/.*$/gm, '')
  // Remove multi-line comments
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '')
  return JSON.parse(cleaned)
}

describe('Configuration Verification Tests', () => {
  describe('vite.config.ts', () => {
    it('should have correct outDir set to "build"', () => {
      const viteConfig = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf-8')
      expect(viteConfig).toContain('outDir: \'build\'')
    })

    it('should have correct server port set to 3000', () => {
      const viteConfig = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf-8')
      expect(viteConfig).toContain('port: 3000')
    })

    it('should have path alias "@" configured', () => {
      const viteConfig = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf-8')
      expect(viteConfig).toContain('@')
      expect(viteConfig).toContain('./src')
    })

    it('should have sourcemap enabled', () => {
      const viteConfig = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf-8')
      expect(viteConfig).toContain('sourcemap: true')
    })

    it('should have React plugin configured', () => {
      const viteConfig = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf-8')
      expect(viteConfig).toContain('react()')
    })

    it('should have manual chunks configured for code splitting', () => {
      const viteConfig = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf-8')
      expect(viteConfig).toContain('manualChunks')
      expect(viteConfig).toContain('react-vendor')
      expect(viteConfig).toContain('ui-vendor')
      expect(viteConfig).toContain('auth-vendor')
    })
  })

  describe('tsconfig.json', () => {
    it('should have correct target set to ES2020', () => {
      const tsconfig = parseJSONC(readFileSync(resolve(__dirname, '../../tsconfig.json'), 'utf-8'))
      expect(tsconfig.compilerOptions.target).toBe('ES2020')
    })

    it('should have bundler module resolution', () => {
      const tsconfig = parseJSONC(readFileSync(resolve(__dirname, '../../tsconfig.json'), 'utf-8'))
      expect(tsconfig.compilerOptions.moduleResolution).toBe('bundler')
    })

    it('should have noEmit set to true', () => {
      const tsconfig = parseJSONC(readFileSync(resolve(__dirname, '../../tsconfig.json'), 'utf-8'))
      expect(tsconfig.compilerOptions.noEmit).toBe(true)
    })

    it('should have strict mode enabled', () => {
      const tsconfig = parseJSONC(readFileSync(resolve(__dirname, '../../tsconfig.json'), 'utf-8'))
      expect(tsconfig.compilerOptions.strict).toBe(true)
    })

    it('should have path alias "@/*" configured', () => {
      const tsconfig = parseJSONC(readFileSync(resolve(__dirname, '../../tsconfig.json'), 'utf-8'))
      expect(tsconfig.compilerOptions.paths).toHaveProperty('@/*')
      expect(tsconfig.compilerOptions.paths['@/*']).toEqual(['./src/*'])
    })

    it('should have jsx set to react-jsx', () => {
      const tsconfig = parseJSONC(readFileSync(resolve(__dirname, '../../tsconfig.json'), 'utf-8'))
      expect(tsconfig.compilerOptions.jsx).toBe('react-jsx')
    })

    it('should include src directory', () => {
      const tsconfig = parseJSONC(readFileSync(resolve(__dirname, '../../tsconfig.json'), 'utf-8'))
      expect(tsconfig.include).toContain('src')
    })
  })

  describe('package.json', () => {
    it('should have correct dev script using vite', () => {
      const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))
      expect(packageJson.scripts.dev).toBe('vite')
    })

    it('should have correct build script with tsc and vite build', () => {
      const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))
      expect(packageJson.scripts.build).toBe('tsc && vite build')
    })

    it('should have preview script', () => {
      const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))
      expect(packageJson.scripts.preview).toBe('vite preview')
    })

    it('should have vite as a dependency', () => {
      const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))
      expect(packageJson.devDependencies).toHaveProperty('vite')
    })

    it('should have @vitejs/plugin-react as a dependency', () => {
      const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))
      expect(packageJson.devDependencies).toHaveProperty('@vitejs/plugin-react')
    })

    it('should have react-router-dom as a dependency', () => {
      const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))
      expect(packageJson.dependencies).toHaveProperty('react-router-dom')
    })

    it('should NOT have next as a dependency', () => {
      const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))
      expect(packageJson.dependencies).not.toHaveProperty('next')
      expect(packageJson.devDependencies).not.toHaveProperty('next')
    })

    it('should NOT have eslint-config-next as a dependency', () => {
      const packageJson = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))
      expect(packageJson.devDependencies).not.toHaveProperty('eslint-config-next')
    })
  })

  describe('index.html', () => {
    it('should have correct DOCTYPE and html structure', () => {
      const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8')
      expect(indexHtml).toContain('<!DOCTYPE html>')
      expect(indexHtml).toContain('<html lang="en">')
    })

    it('should have root div element', () => {
      const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8')
      expect(indexHtml).toContain('<div id="root"></div>')
    })

    it('should reference main.tsx as module script', () => {
      const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8')
      expect(indexHtml).toContain('<script type="module" src="/src/main.tsx"></script>')
    })

    it('should have correct title', () => {
      const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8')
      expect(indexHtml).toContain('<title>Fullstack AgentCore Solution Template</title>')
    })

    it('should have meta description', () => {
      const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8')
      expect(indexHtml).toContain('<meta name="description"')
    })

    it('should have viewport meta tag', () => {
      const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8')
      expect(indexHtml).toContain('<meta name="viewport" content="width=device-width, initial-scale=1.0"')
    })

    it('should have favicon link', () => {
      const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8')
      expect(indexHtml).toContain('favicon.ico')
    })

    it('should have Google Fonts preconnect links', () => {
      const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8')
      expect(indexHtml).toContain('fonts.googleapis.com')
      expect(indexHtml).toContain('fonts.gstatic.com')
    })
  })
})
