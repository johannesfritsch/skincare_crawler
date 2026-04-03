import type { CollectionAfterChangeHook } from 'payload'

const COOLDOWN_MS = 60 * 60 * 1000 // 1 hour

/**
 * afterChange hook on the Events collection.
 * When a critical event is created, batches recent critical events and sends
 * a single email. Cooldown state is stored in the crawler-settings global
 * (database-backed, multi-node safe).
 */
export const criticalEventNotifier: CollectionAfterChangeHook = async ({
  doc,
  operation,
  req,
}) => {
  if (operation !== 'create') return doc
  if (doc.level !== 'critical') return doc

  try {
    // Read last-sent timestamp from database (multi-node safe)
    const settings = await req.payload.findGlobal({ slug: 'crawler-settings' })
    const lastSentAt = settings.lastCriticalEmailAt
      ? new Date(settings.lastCriticalEmailAt as string).getTime()
      : 0
    const now = Date.now()

    if (now - lastSentAt < COOLDOWN_MS) return doc // cooldown active

    // Collect all critical events since last email
    const since = new Date(lastSentAt || now - COOLDOWN_MS)
    const { docs: criticalEvents } = await req.payload.find({
      collection: 'events',
      where: {
        level: { equals: 'critical' },
        createdAt: { greater_than: since.toISOString() },
      },
      sort: '-createdAt',
      limit: 50,
    })

    if (criticalEvents.length === 0) return doc

    // Update timestamp BEFORE sending (prevents duplicate sends from concurrent nodes)
    await req.payload.updateGlobal({
      slug: 'crawler-settings',
      data: { lastCriticalEmailAt: new Date().toISOString() },
    })

    // Determine recipients
    const alertEmail =
      (settings.alertEmail as string)?.trim() || 'fritsch@zoom7.de'

    // Build email
    const subject = `[AnySkin Crawler] ${criticalEvents.length} critical event(s)`
    const rows = criticalEvents
      .map((e) => {
        const data = e.data as Record<string, unknown> | null
        const time = new Date(e.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })
        const source = data?.source ?? ''
        const url = data?.url ?? ''
        return `<tr>
          <td style="padding:4px 8px;border:1px solid #ddd">${time}</td>
          <td style="padding:4px 8px;border:1px solid #ddd">${e.name || ''}</td>
          <td style="padding:4px 8px;border:1px solid #ddd">${source}</td>
          <td style="padding:4px 8px;border:1px solid #ddd">${e.message}</td>
          <td style="padding:4px 8px;border:1px solid #ddd;font-size:12px">${url}</td>
        </tr>`
      })
      .join('\n')

    const html = `
      <h2>AnySkin Crawler: ${criticalEvents.length} Critical Event(s)</h2>
      <p>The following critical events occurred since ${since.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}:</p>
      <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
        <thead>
          <tr style="background:#f5f5f5">
            <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Time</th>
            <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Event</th>
            <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Source</th>
            <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Message</th>
            <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">URL</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <p style="color:#888;font-size:12px;margin-top:16px">
        Next alert will be sent at the earliest ${new Date(now + COOLDOWN_MS).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}.
      </p>
    `

    await req.payload.sendEmail({ to: alertEmail, subject, html })
    req.payload.logger.info(`Critical alert email sent to ${alertEmail} (${criticalEvents.length} events)`)
  } catch (err) {
    // Never fail event creation because of email issues
    req.payload.logger.warn({ err }, 'Failed to send critical event email')
  }

  return doc
}
