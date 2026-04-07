import type { GlobalConfig } from 'payload'

export const Changelog: GlobalConfig = {
  slug: 'changelog',
  label: 'Changelog',
  admin: {
    group: 'System',
  },
  fields: [
    {
      name: 'changelogView',
      type: 'ui',
      admin: {
        components: {
          Field: '/components/dashboard/widgets/ChangelogClient',
        },
      },
    },
  ],
}
