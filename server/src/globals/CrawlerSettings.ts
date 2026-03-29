import type { GlobalConfig } from 'payload'

export const CrawlerSettings: GlobalConfig = {
  slug: 'crawler-settings',
  label: 'Crawler Settings',
  admin: {
    group: 'System',
  },
  fields: [
    {
      name: 'alertEmail',
      type: 'text',
      admin: {
        description: 'Email address(es) for critical alerts (comma-separated). Falls back to ALERT_EMAIL env var.',
      },
    },
    {
      name: 'lastCriticalEmailAt',
      type: 'date',
      admin: {
        description: 'Timestamp of the last critical alert email sent (used for 1-hour cooldown).',
        readOnly: true,
        date: {
          displayFormat: 'yyyy-MM-dd HH:mm:ss',
        },
      },
    },
  ],
}
