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
      defaultValue: 'fritsch@zoom7.de',
      admin: {
        description: 'Email address(es) for critical alerts (comma-separated).',
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
    {
      name: 'instagramCookies',
      type: 'textarea',
      admin: {
        description: 'Instagram cookies in Netscape format. Export from browser via "Get cookies.txt LOCALLY" extension and paste here.',
      },
    },
    {
      name: 'tiktokCookies',
      type: 'textarea',
      admin: {
        description: 'TikTok cookies in Netscape format. Export from browser via "Get cookies.txt LOCALLY" extension and paste here.',
      },
    },
  ],
}
