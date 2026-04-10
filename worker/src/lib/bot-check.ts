import { launchBrowser } from '@/lib/browser'
import { captureDebugScreenshot } from '@/lib/debug-screenshot'
import type { PayloadRestClient } from '@/lib/payload-client'
import { createLogger } from '@/lib/logger'

const log = createLogger('BotCheck')

interface BotCheckResult {
  screenshotUrl: string | null
  resultJson: {
    tests: Array<{ name: string; value: string | boolean | number; passed: boolean }>
    passed: number
    failed: number
    total: number
    url: string
    checkedAt: string
  }
}

export async function runBotCheck(
  url: string,
  client: PayloadRestClient,
  jobId: number,
  jlog: ReturnType<typeof log.forJob>,
): Promise<BotCheckResult> {
  const browser = await launchBrowser()
  try {
    const page = await browser.newPage()

    jlog.info('Navigating to bot detector', { url })
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    // Wait for the tests to complete — the page shows results after running checks.
    // Poll for a completion indicator (the page typically shows test results after a few seconds).
    jlog.info('Waiting for bot detection tests to complete')
    try {
      await page.waitForSelector('[class*="test-result"], [class*="Result"], .passed, .failed, [data-status]', { timeout: 20_000 })
    } catch {
      // If no specific selector found, just wait a fixed time for the page to finish
      jlog.info('No specific result selector found, waiting 15s for page to settle')
      await new Promise(r => setTimeout(r, 15_000))
    }

    // Extra wait for any final rendering
    await new Promise(r => setTimeout(r, 3000))

    // Extract test results from the page
    const extractedResults = await page.evaluate(() => {
      const tests: Array<{ name: string; value: string; passed: boolean }> = []

      // Strategy 1: Look for table rows with test data
      const rows = document.querySelectorAll('tr')
      for (const row of rows) {
        const cells = row.querySelectorAll('td')
        if (cells.length >= 2) {
          const name = cells[0]?.textContent?.trim() || ''
          const value = cells[1]?.textContent?.trim() || ''
          if (name && value) {
            // Determine pass/fail from row class, cell content, or color
            const rowText = row.textContent?.toLowerCase() || ''
            const style = window.getComputedStyle(row)
            const color = style.backgroundColor || style.color || ''
            const passed = !rowText.includes('fail') &&
              !rowText.includes('bot') &&
              !color.includes('red') &&
              !row.classList.toString().includes('fail') &&
              !row.classList.toString().includes('error')
            tests.push({ name, value, passed })
          }
        }
      }

      // Strategy 2: Look for divs/sections with test names and status indicators
      if (tests.length === 0) {
        const items = document.querySelectorAll('[class*="test"], [class*="check"], [class*="result"], [class*="item"]')
        for (const item of items) {
          const text = item.textContent?.trim() || ''
          if (text.length > 3 && text.length < 200) {
            const classList = item.classList.toString().toLowerCase()
            const passed = classList.includes('pass') || classList.includes('success') || classList.includes('ok')
            const failed = classList.includes('fail') || classList.includes('error') || classList.includes('warn')
            if (passed || failed) {
              tests.push({ name: text.slice(0, 80), value: passed ? 'passed' : 'failed', passed })
            }
          }
        }
      }

      // Strategy 3: Fallback — grab the full page text for analysis
      if (tests.length === 0) {
        const bodyText = document.body.innerText
        // Try to parse lines that look like "Test Name: value" or "Test Name ... passed/failed"
        const lines = bodyText.split('\n').filter(l => l.trim().length > 0)
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.length > 5 && trimmed.length < 150) {
            const lower = trimmed.toLowerCase()
            if (lower.includes('pass') || lower.includes('fail') || lower.includes('ok') || lower.includes('error') || lower.includes('detected')) {
              const passed = lower.includes('pass') || lower.includes('ok') || !lower.includes('detected')
              tests.push({ name: trimmed.slice(0, 80), value: passed ? 'passed' : 'failed', passed })
            }
          }
        }
      }

      return tests
    })

    const passed = extractedResults.filter(t => t.passed).length
    const failed = extractedResults.filter(t => !t.passed).length

    // Take screenshot
    const screenshotUrl = await captureDebugScreenshot({
      page,
      client,
      jobCollection: 'bot-checks',
      jobId,
      step: 'bot-check-result',
      label: `Bot check: ${passed}/${extractedResults.length} passed`,
    })

    jlog.info('Bot check complete', { passed, failed, total: extractedResults.length })

    return {
      screenshotUrl,
      resultJson: {
        tests: extractedResults,
        passed,
        failed,
        total: extractedResults.length,
        url,
        checkedAt: new Date().toISOString(),
      },
    }
  } finally {
    await browser.close()
  }
}
