#!/usr/bin/env node

/**
 * Generates a changelog JSON file from git log.
 * Run at build time — output is a static file imported by the dashboard widget.
 *
 * Output: src/changelog.json
 * Format: { generatedAt, commits: [{ hash, shortHash, message, author, date }] }
 */

import { execSync } from 'child_process'
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outputPath = resolve(__dirname, '../public/changelog.json')

const MAX_COMMITS = 50

try {
  // Use %x00 as delimiter to handle messages with special characters
  const raw = execSync(
    `git log -${MAX_COMMITS} --format="%H%x00%h%x00%s%x00%an%x00%aI"`,
    { encoding: 'utf-8', cwd: resolve(__dirname, '../..') },
  ).trim()

  const commits = raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, message, author, date] = line.split('\x00')
      return { hash, shortHash, message, author, date }
    })

  const changelog = {
    generatedAt: new Date().toISOString(),
    commits,
  }

  writeFileSync(outputPath, JSON.stringify(changelog, null, 2), 'utf-8')
  console.log(`Changelog generated: ${commits.length} commits → ${outputPath}`)
} catch (err) {
  // Non-fatal — write empty changelog if git is not available
  console.warn('Could not generate changelog:', err.message)
  writeFileSync(
    outputPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), commits: [] }, null, 2),
    'utf-8',
  )
}
