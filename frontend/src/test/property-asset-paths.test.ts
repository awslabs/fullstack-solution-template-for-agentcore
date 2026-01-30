// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Property-based test for public asset path handling
 *  * 
 * This test verifies that all references to public assets in the source code
 * do not include the "/public" prefix, as Vite serves public assets from the
 * root path.
 */

import { describe, it } from 'vitest'
import * as fc from 'fast-check'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Recursively get all source files
 * @param dir - Directory path to search
 * @param fileList - Accumulated list of files
 * @returns Array of file paths
 */
function getAllSourceFiles(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir)
  
  files.forEach(file => {
    const filePath = path.join(dir, file)
    const stat = fs.statSync(filePath)
    
    if (stat.isDirectory()) {
      // Skip node_modules, build, and hidden directories
      if (!file.startsWith('.') && file !== 'node_modules' && file !== 'build') {
        getAllSourceFiles(filePath, fileList)
      }
    } else if (file.match(/\.(ts|tsx|js|jsx|html|css)$/)) {
      fileList.push(filePath)
    }
  })
  
  return fileList
}

/**
 * Find asset references in file content
 * @param content - File content
 * @returns Array of asset paths found
 */
function findAssetReferences(content: string): string[] {
  const references: string[] = []
  
  // Match common asset reference patterns
  const patterns = [
    /src=["']([^"']+)["']/g,           // src attribute
    /href=["']([^"']+)["']/g,          // href attribute
    /url\(["']?([^"')]+)["']?\)/g,     // CSS url()
    /fetch\(["']([^"']+)["']/g,        // fetch calls
    /import.*from ["']([^"']+)["']/g,  // imports
  ]
  
  patterns.forEach(pattern => {
    let match
    while ((match = pattern.exec(content)) !== null) {
      references.push(match[1])
    }
  })
  
  return references
}

describe('Public Asset Path Handling', () => {
  const srcDir = path.resolve(__dirname, '..')
  const allSourceFiles = getAllSourceFiles(srcDir)
  
  it('should not include "/public" prefix in any asset references', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allSourceFiles),
        (filePath) => {
          const content = fs.readFileSync(filePath, 'utf-8')
          const assetRefs = findAssetReferences(content)
          
          // Check that no asset reference includes "/public" prefix
          const hasPublicPrefix = assetRefs.some(ref => 
            ref.startsWith('/public/') || 
            ref.includes('"/public/') ||
            ref.includes("'/public/")
          )
          
          return !hasPublicPrefix
        }
      ),
      { numRuns: 100 }
    )
  })
  
  it('should use root-relative paths for public assets', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allSourceFiles),
        (filePath) => {
          const content = fs.readFileSync(filePath, 'utf-8')
          
          // Look for common public asset references
          const hasAwsExports = /['"]\/aws-exports\.json['"]/g.test(content)
          const hasFavicon = /['"]\/favicon\./g.test(content)
          
          if (hasAwsExports || hasFavicon) {
            // These should be root-relative (starting with /) but not /public/
            const hasCorrectPath = 
              (hasAwsExports && /['"]\/aws-exports\.json['"]/g.test(content)) ||
              (hasFavicon && /['"]\/favicon\./g.test(content))
            
            const hasIncorrectPath = 
              /['"]\/public\/aws-exports\.json['"]/g.test(content) ||
              /['"]\/public\/favicon\./g.test(content)
            
            return hasCorrectPath && !hasIncorrectPath
          }
          
          // If no public assets referenced, test passes
          return true
        }
      ),
      { numRuns: 100 }
    )
  })
  
  it('should not have "public/" in string literals for asset paths', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...allSourceFiles),
        (filePath) => {
          // Skip test files that might reference the pattern
          if (filePath.includes('/test/')) {
            return true
          }
          
          const content = fs.readFileSync(filePath, 'utf-8')
          
          // Check for "public/" in string literals (but allow in comments)
          const lines = content.split('\n')
          const codeLines = lines.filter(line => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
          const codeContent = codeLines.join('\n')
          
          // Look for "public/" in strings
          const hasPublicInString = /["'].*public\/.*["']/g.test(codeContent)
          
          return !hasPublicInString
        }
      ),
      { numRuns: 100 }
    )
  })
  
  it('should use correct Vite public asset serving pattern', () => {
    const indexHtmlPath = path.resolve(__dirname, '../../index.html')
    
    if (!fs.existsSync(indexHtmlPath)) {
      // If index.html doesn't exist, skip this test
      return
    }
    
    fc.assert(
      fc.property(
        fc.constant(indexHtmlPath),
        (filePath) => {
          const content = fs.readFileSync(filePath, 'utf-8')
          
          // In index.html, public assets should be referenced from root
          const hasFavicon = /href=["']\/favicon\./g.test(content)
          
          if (hasFavicon) {
            // Should not have /public/ prefix
            const hasIncorrectPath = /href=["']\/public\/favicon\./g.test(content)
            return !hasIncorrectPath
          }
          
          return true
        }
      ),
      { numRuns: 100 }
    )
  })
})
