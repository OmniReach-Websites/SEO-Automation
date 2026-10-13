import {
  arrayField,
  loadSiteSnapshot,
  objectField,
  textField,
  type SiteContent,
} from '@omnireach/site-runtime';

export const SITE_URL = 'https://coopsmobiledetailingaledo.com';
export const INSTAGRAM_URL = 'https://instagram.com/coops_mobile_detailing';

interface ServiceDescription {
  alt: string;
  description: string;
  featured?: boolean;
  id: string;
  image: string;
  imageSmall: string;
  includes: string[];
  name: string;
}
interface PriceCard {
  id: string;
  price: string;
}
interface GalleryDescription {
  alt: string;
  caption: string;
  category: 'before-after' | 'exterior' | 'interior';
  id: string;
  order: number;
  title: string;
  visible: boolean;
}
interface GalleryImage {
  id: string;
  image: string;
  thumbnail: string;
}
interface Faq {
  answer: string;
  question: string;
}
interface PhoneFact {
  display: string;
  href: string;
}
interface GoalFact {
  currentAmount?: number;
  target: number;
  visible: boolean;
}
interface MetadataEntry {
  description: string;
  image?: string;
  title: string;
}
type SiteMetadata = Record<string, MetadataEntry>;

const defaultServices: ServiceDescription[] = [
  {
    id: 'exterior-detail',
    name: 'Exterior Detail',
    description: 'A careful exterior clean for paint, wheels, tires, and glass.',
    image: '/images/work-2.webp',
    imageSmall: '/images/work-2-480.webp',
    alt: 'Blue Ford Mustang covered in foam during an exterior detail',
    includes: [
      'Foam wash and hand wash',
      'Wheel and tire cleaning',
      'Tire shine',
      'Exterior glass cleaning',
    ],
  },
  {
    id: 'interior-detail',
    name: 'Interior Detail',
    description: 'A focused interior reset for the surfaces you see and use every day.',
    image: '/images/work-4.webp',
    imageSmall: '/images/work-4-480.webp',
    alt: 'Clean tan leather rear seating after an interior detail',
    includes: [
      'Vacuum and wipe-down',
      'Interior glass cleaning',
      'Leather conditioning',
      'Odor treatment',
    ],
  },
  {
    id: 'full-detail',
    name: 'Full Detail',
    description: 'Interior and exterior detailing combined into one complete service.',
    image: '/images/work-6.webp',
    imageSmall: '/images/work-6-480.webp',
    alt: 'Detailed blue Jeep parked outside in Aledo, Texas',
    includes: ['Exterior Detail', 'Interior Detail'],
    featured: true,
  },
];

const defaultPrices: PriceCard[] = [
  { id: 'exterior-detail', price: '$60' },
  { id: 'interior-detail', price: '$100' },
  { id: 'full-detail', price: '$120' },
];

const galleryRows = [
  [
    'mustang-hand-wash',
    'exterior',
    'Hands-on exterior care',
    'Cooper detailing the front of a blue Ford Mustang.',
    'Cooper hand detailing the front bumper of a blue Ford Mustang in a driveway',
  ],
  [
    'mustang-foam-wash',
    'exterior',
    'Foam wash',
    'Foam coverage during an exterior detail.',
    'Blue Ford Mustang covered in white foam during an exterior wash',
  ],
  [
    'mustang-finish',
    'exterior',
    'Glossy finish',
    'Clean reflections across the hood and front quarter panel.',
    'Close view of a glossy blue Ford Mustang hood and headlight after detailing',
  ],
  [
    'tan-interior',
    'interior',
    'Leather interior',
    'Detailed tan leather seating and interior surfaces.',
    'Clean tan leather rear seats and carpeting inside a vehicle',
  ],
  [
    'tan-cabin',
    'interior',
    'Cabin reset',
    'A clean, tidy passenger cabin.',
    'Clean tan leather passenger seating inside a vehicle',
  ],
  [
    'jeep-front',
    'exterior',
    'Jeep exterior',
    'Finished exterior work on a blue Jeep.',
    'Detailed blue Jeep viewed from the front passenger side',
  ],
  [
    'jeep-wheel',
    'exterior',
    'Wheel and fender',
    'Clean wheel, tire, and exterior trim details.',
    'Close view of a clean blue Jeep front fender, wheel, and tire',
  ],
  [
    'jeep-reflection',
    'exterior',
    'Clean reflections',
    'A clear reflection on a detailed blue door panel.',
    'Reflective blue Jeep door panel after exterior detailing',
  ],
  [
    'interior-before-after',
    'before-after',
    'Interior before and after',
    'The after view from the verified comparison set.',
    'Clean black rear seating after an interior detail',
  ],
] as const;
const defaultGalleryDescriptions: GalleryDescription[] = galleryRows.map(
  ([id, category, title, caption, alt], order) => ({
    alt,
    caption,
    category,
    id,
    order,
    title,
    visible: true,
  }),
);
const defaultGalleryImages: GalleryImage[] = (
  [
    ['mustang-hand-wash', '/images/work-1.webp', '/images/work-1-480.webp'],
    ['mustang-foam-wash', '/images/work-2.webp', '/images/work-2-480.webp'],
    ['mustang-finish', '/images/work-3.webp', '/images/work-3-480.webp'],
    ['tan-interior', '/images/work-4.webp', '/images/work-4-480.webp'],
    ['tan-cabin', '/images/work-5.webp', '/images/work-5-480.webp'],
    ['jeep-front', '/images/work-6.webp', '/images/work-6-480.webp'],
    ['jeep-wheel', '/images/work-7.webp', '/images/work-7-480.webp'],
    ['jeep-reflection', '/images/work-8.webp', '/images/work-8-480.webp'],
    ['interior-before-after', '/images/after-interior.webp', '/images/after-interior-420.webp'],
  ] as const
).map(([id, image, thumbnail]) => ({ id, image, thumbnail }));

const defaultFaqs: Faq[] = [
  {
    question: 'Do I need to provide water and electricity?',
    answer: 'Yes. Water and electricity need to be available at the service location.',
  },
  {
    question: 'How long does a detail take?',
    answer:
      'Most details take approximately 1.5–3.5 hours. Timing varies with vehicle size and condition.',
  },
  {
    question: 'What happens if the weather changes?',
    answer: 'Weather may require rescheduling. Contact Cooper to confirm the next practical time.',
  },
  {
    question: 'Is pet hair removal available?',
    answer: 'Yes. Pet hair removal is available as an add-on. Mention it when requesting a quote.',
  },
  {
    question: 'Is the starting price the final price?',
    answer:
      'Final pricing can vary depending on vehicle size and condition. Contact Cooper for a quote.',
  },
  {
    question: 'How do I request a quote?',
    answer:
      'Call or text Cooper with your vehicle type, desired service, vehicle condition, and service location.',
  },
];

export const defaultCoopContent: SiteContent = {
  'home.heading': 'Professional Mobile Detailing in Aledo, TX',
  'home.intro':
    '<p>Quality vehicle detailing brought to your location. See the work, choose a service, and contact Cooper for a quote.</p>',
  'home.hero-image': {
    src: '/images/work-3.webp',
    alt: 'Detailed blue Ford Mustang with a glossy finish',
    small: '/images/work-3-480.webp',
  },
  'home.primary-cta-label': 'Call Cooper',
  'home.highlights.items': [
    { id: 'mobile', title: 'Mobile service', description: 'At your location' },
    { id: 'local', title: 'Based in Aledo', description: 'Serving nearby communities' },
    { id: 'inside-out', title: 'Inside + out', description: 'Three detailing packages' },
    { id: 'contact', title: 'Call or text', description: 'Contact Cooper directly' },
  ],
  'home.section-order': [
    'highlights',
    'featured-work',
    'services',
    'mobile-detailing',
    'comparison',
    'story',
    'goal',
    'areas',
    'faq',
    'cta',
  ],
  'services.descriptions': defaultServices,
  'portfolio.items': defaultGalleryDescriptions,
  'portfolio.images': defaultGalleryImages,
  'site.metadata': {
    home: {
      title: 'Mobile Car Detailing in Aledo, TX',
      description:
        'Mobile interior, exterior, and full vehicle detailing in Aledo, Weatherford, Willow Park, Fort Worth, and surrounding communities. Call or text Cooper for a quote.',
    },
    services: {
      title: 'Mobile Detailing Services',
      description:
        "Explore exterior, interior, and full mobile detailing packages from Coop's Mobile Detailing in Aledo, Texas. Starting prices from $60.",
    },
    portfolio: {
      title: 'Our Detailing Work',
      description:
        "See real exterior and interior detailing work from Coop's Mobile Detailing, including an interactive before-and-after comparison.",
    },
    about: {
      title: 'About Cooper',
      description:
        "Meet Cooper, the high school student behind Coop's Mobile Detailing in Aledo, Texas, and learn why he started his local detailing business.",
    },
    contact: {
      title: 'Contact Cooper',
      description:
        'Call or text Cooper for a mobile detailing quote in Aledo, Weatherford, Willow Park, Fort Worth, and surrounding communities.',
    },
    privacy: {
      title: 'Privacy Notice',
      description:
        "Privacy notice for the Coop's Mobile Detailing website and its call, text, and third-party links.",
    },
  },
  'site.theme': 'default',
};

export const defaultCoopFacts: SiteContent = {
  'goal.financial-progress': { target: 7000, visible: false },
  'services.prices': defaultPrices,
  'services.availability': ['Pet hair removal', 'Engine bay cleaning', 'Ceramic coating'],
  'about.story':
    "<p>Cooper is a high school student building Coop's Mobile Detailing while saving toward his first car. Rather than making the business sound bigger than it is, the work stays personal: customers contact Cooper directly, and every job contributes to a real goal.</p><p>That story is part of what makes Coop's different from a generic detailing company. The site keeps the focus on visible work, straightforward services, and easy contact.</p>",
  'business.service-policy': defaultFaqs,
  'business.phone': { display: '(817) 757-6030', href: 'tel:+18177576030' },
  'business.service-areas': ['Aledo', 'Weatherford', 'Willow Park', 'Fort Worth'],
  'legal.privacy':
    '<div class="legal-alert"><strong>Plain-language summary.</strong><p>This notice describes how the current static website operates. The website does not include forms, accounts, online payments, or booking software.</p></div><h2>Information submitted through this website</h2><p>This static website does not include a contact form, account, payment flow, or booking system. It does not intentionally collect information through a website form.</p><h2>Calling and texting</h2><p>If you choose a call or text link, your device and telecommunications provider handle that communication. Information you send directly to the business may include your phone number, vehicle details, requested service, and service location.</p><h2>Third-party links</h2><p>The site may link to Instagram. A third-party service applies its own privacy practices when you leave this website.</p><h2>Analytics and platform services</h2><p>This website uses Google Analytics 4 only when you choose “Allow analytics.” Until then, analytics storage is denied. When allowed, Google Analytics may use first-party cookies and collect usage information such as visited pages, approximate location, device details, and referral source to help understand and improve the website. Advertising storage and personalized advertising remain disabled. You can change your choice at any time using “Analytics choices” in the footer.</p><h2>Questions</h2><p>Use the verified phone contact on the <a href="/contact/">Contact page</a> for questions about the business. A verified privacy email has not been supplied.</p><p class="legal-footnote">Effective date: October 13, 2026.</p>',
};

const snapshot = loadSiteSnapshot(defaultCoopContent);
const content = snapshot.content;
const facts: SiteContent = { ...defaultCoopFacts, ...snapshot.facts };
const managedAssets = snapshot.assets;

export const homeCopy = {
  heading: textField(content, 'home.heading', String(defaultCoopContent['home.heading'])),
  intro: textField(content, 'home.intro', String(defaultCoopContent['home.intro'])),
};
const heroImageValue = objectField(
  content,
  'home.hero-image',
  defaultCoopContent['home.hero-image'],
  isImage,
) as { alt: string; small?: string; src: string };
export const heroImage = {
  ...heroImageValue,
  src: publicAsset(heroImageValue.src),
  ...(heroImageValue.small ? { small: publicAsset(heroImageValue.small) } : {}),
};
export const primaryCtaLabel = textField(content, 'home.primary-cta-label', 'Call Cooper');
export const highlights = arrayField(
  content,
  'home.highlights.items',
  defaultCoopContent['home.highlights.items'] as readonly {
    description: string;
    id: string;
    title: string;
  }[],
  isHighlight,
);
export const homeSectionOrder = stringArray(
  content['home.section-order'],
  defaultCoopContent['home.section-order'] as string[],
);
export const siteTheme = textField(content, 'site.theme', 'default');

const prices = arrayValue(facts['services.prices'], defaultPrices, isPrice);
const priceById = new Map(prices.map((price) => [price.id, price.price]));
export const services = arrayField(
  content,
  'services.descriptions',
  defaultServices,
  isService,
).map((service) => ({
  ...service,
  image: publicAsset(service.image),
  imageSmall: publicAsset(service.imageSmall),
  price: priceById.get(service.id) ?? 'Contact for quote',
}));
export const addOns = stringArray(
  facts['services.availability'],
  defaultCoopFacts['services.availability'] as string[],
);

const galleryImages = arrayField(
  content,
  'portfolio.images',
  defaultGalleryImages,
  isGalleryImage,
).map((image) => ({
  ...image,
  image: publicAsset(image.image),
  thumbnail: publicAsset(image.thumbnail),
}));
const galleryImageById = new Map(galleryImages.map((image) => [image.id, image]));
export const galleryItems = arrayField(
  content,
  'portfolio.items',
  defaultGalleryDescriptions,
  isGalleryDescription,
)
  .filter((item) => item.visible)
  .sort((left, right) => left.order - right.order)
  .flatMap((item) => {
    const image = galleryImageById.get(item.id);
    return image ? [{ ...item, ...image }] : [];
  });
export const galleryCategories = [
  { id: 'all', label: 'All work' },
  { id: 'exterior', label: 'Exterior' },
  { id: 'interior', label: 'Interior' },
  { id: 'before-after', label: 'Before & after' },
] as const;

export const aboutStory = factText(facts, 'about.story', String(defaultCoopFacts['about.story']));
export const faqs = arrayValue(facts['business.service-policy'], defaultFaqs, isFaq);
export const serviceAreas = stringArray(
  facts['business.service-areas'],
  defaultCoopFacts['business.service-areas'] as string[],
);
const phone = factObject(
  facts,
  'business.phone',
  defaultCoopFacts['business.phone'] as PhoneFact,
  isPhone,
);
export const PHONE_DISPLAY = phone.display;
export const CALL_HREF = phone.href;
export const PHONE_E164 = phone.href.replace(/^tel:/u, '');
export const TEXT_HREF = `sms:${PHONE_E164}`;
export const privacyContent = factText(
  facts,
  'legal.privacy',
  String(defaultCoopFacts['legal.privacy']),
);
export const goal = factObject(
  facts,
  'goal.financial-progress',
  defaultCoopFacts['goal.financial-progress'] as GoalFact,
  isGoal,
);
export const siteMetadata = objectField(
  content,
  'site.metadata',
  defaultCoopContent['site.metadata'],
  isMetadata,
) as SiteMetadata;
export function metadataFor(route: string): MetadataEntry {
  const fallbacks = defaultCoopContent['site.metadata'] as SiteMetadata;
  const metadata = siteMetadata[route] ??
    fallbacks[route] ?? {
      title: "Coop's Mobile Detailing",
      description: 'Mobile detailing in Aledo, Texas.',
    };
  return {
    ...metadata,
    ...(metadata.image ? { image: publicAsset(metadata.image) } : {}),
  };
}

export const localBusinessSchema = {
  '@context': 'https://schema.org',
  '@type': 'AutomotiveBusiness',
  name: "Coop's Mobile Detailing",
  url: SITE_URL,
  image: `${SITE_URL}/images/social-card.webp`,
  telephone: PHONE_E164,
  description: 'Mobile automotive detailing based in Aledo, Texas.',
  areaServed: serviceAreas.map((name) => ({ '@type': 'City', name })),
  sameAs: [INSTAGRAM_URL],
  hasOfferCatalog: {
    '@type': 'OfferCatalog',
    name: 'Mobile detailing services',
    itemListElement: services.map((service) => ({
      '@type': 'Offer',
      priceCurrency: 'USD',
      price: service.price.replace(/[^0-9.]/gu, ''),
      itemOffered: { '@type': 'Service', name: service.name, description: service.description },
    })),
  },
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown, maximum = 20_000): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}
function asset(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (/^\/images\/[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value)) return true;
  const match = /^asset:([0-9a-f-]{36})$/iu.exec(value);
  return Boolean(match?.[1] && managedAssets[match[1]]);
}
function publicAsset(value: string): string {
  const match = /^asset:([0-9a-f-]{36})$/iu.exec(value);
  return match?.[1] ? (managedAssets[match[1]] ?? value) : value;
}
function id(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,99}$/u.test(value);
}
function isImage(value: unknown): value is { alt: string; small?: string; src: string } {
  return (
    record(value) &&
    asset(value.src) &&
    text(value.alt, 500) &&
    (value.small === undefined || asset(value.small))
  );
}
function isHighlight(value: unknown): value is { description: string; id: string; title: string } {
  return record(value) && id(value.id) && text(value.title, 120) && text(value.description, 300);
}
function isService(value: unknown): value is ServiceDescription {
  return (
    record(value) &&
    id(value.id) &&
    text(value.name, 120) &&
    text(value.description, 1_000) &&
    asset(value.image) &&
    asset(value.imageSmall) &&
    text(value.alt, 500) &&
    Array.isArray(value.includes) &&
    value.includes.length > 0 &&
    value.includes.length <= 20 &&
    value.includes.every((entry) => text(entry, 200)) &&
    (value.featured === undefined || typeof value.featured === 'boolean')
  );
}
function isPrice(value: unknown): value is PriceCard {
  return record(value) && id(value.id) && text(value.price, 40);
}
function isGalleryDescription(value: unknown): value is GalleryDescription {
  return (
    record(value) &&
    id(value.id) &&
    ['before-after', 'exterior', 'interior'].includes(String(value.category)) &&
    text(value.title, 160) &&
    text(value.caption, 500) &&
    text(value.alt, 500) &&
    Number.isInteger(value.order) &&
    Number(value.order) >= 0 &&
    typeof value.visible === 'boolean'
  );
}
function isGalleryImage(value: unknown): value is GalleryImage {
  return record(value) && id(value.id) && asset(value.image) && asset(value.thumbnail);
}
function isFaq(value: unknown): value is Faq {
  return record(value) && text(value.question, 300) && text(value.answer, 2_000);
}
function isPhone(value: unknown): value is PhoneFact {
  return (
    record(value) &&
    text(value.display, 40) &&
    typeof value.href === 'string' &&
    /^tel:\+?[0-9]{7,15}$/u.test(value.href)
  );
}
function isGoal(value: unknown): value is GoalFact {
  return (
    record(value) &&
    typeof value.visible === 'boolean' &&
    typeof value.target === 'number' &&
    value.target > 0 &&
    (value.currentAmount === undefined ||
      (typeof value.currentAmount === 'number' && value.currentAmount >= 0))
  );
}
function isMetadataEntry(value: unknown): value is MetadataEntry {
  return (
    record(value) &&
    text(value.title, 160) &&
    text(value.description, 500) &&
    (value.image === undefined || asset(value.image))
  );
}
function isMetadata(value: unknown): value is SiteMetadata {
  return (
    record(value) && Object.keys(value).length > 0 && Object.values(value).every(isMetadataEntry)
  );
}
function stringArray(value: unknown, fallback: readonly string[]): string[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 100 &&
    value.every((entry) => text(entry, 500))
    ? [...value]
    : [...fallback];
}
function arrayValue<T>(
  value: unknown,
  fallback: readonly T[],
  validate: (entry: unknown) => entry is T,
): T[] {
  return Array.isArray(value) && value.every(validate)
    ? structuredClone(value)
    : fallback.map((entry) => structuredClone(entry));
}
function factText(values: SiteContent, key: string, fallback: string): string {
  return typeof values[key] === 'string' ? values[key] : fallback;
}
function factObject<T>(
  values: SiteContent,
  key: string,
  fallback: T,
  validate: (value: unknown) => value is T,
): T {
  return validate(values[key]) ? structuredClone(values[key]) : structuredClone(fallback);
}
