export const SITE_URL = 'https://omnireach.cloud';

export const services = [
  {
    number: '01',
    title: 'Website strategy & design',
    description:
      'Clear structure, custom presentation, and useful content shaped around what your customers need to know.',
  },
  {
    number: '02',
    title: 'Build & launch',
    description:
      'Fast, responsive websites with dependable hosting, secure delivery, and a careful production launch.',
  },
  {
    number: '03',
    title: 'Search visibility',
    description:
      'Strong technical foundations, local search structure, structured data, and ongoing improvements that help people find you.',
  },
  {
    number: '04',
    title: 'Managed website care',
    description:
      'Monitoring, updates, publishing support, and practical maintenance after your site goes live.',
  },
] as const;

export const process = [
  [
    'Discover',
    'We learn the business, audience, priorities, and facts that the website must communicate.',
  ],
  ['Build', 'We design and develop the site, then review it with you before anything goes live.'],
  ['Launch', 'We connect the domain, secure the site, and verify the experience across devices.'],
  [
    'Maintain',
    'We keep the technical foundation healthy and help the site stay current over time.',
  ],
] as const;
