import { loadSiteContent, textField } from '@omnireach/site-runtime';

export const SITE_URL = 'https://coopsmobiledetailing.vercel.app';
export const PHONE_E164 = '+18177576030';
export const PHONE_DISPLAY = '(817) 757-6030';
export const CALL_HREF = `tel:${PHONE_E164}`;
export const TEXT_HREF = `sms:${PHONE_E164}`;
export const INSTAGRAM_URL = 'https://instagram.com/coops_mobile_detailing';

const content = loadSiteContent();

export const homeCopy = {
  heading: textField(content, 'home.heading', 'Professional Mobile Detailing in Aledo, TX'),
  intro: textField(
    content,
    'home.intro',
    'Quality vehicle detailing brought to your location. See the work, choose a service, and contact Cooper for a quote.',
  ),
};

export const services = [
  {
    id: 'exterior-detail',
    name: 'Exterior Detail',
    price: '$60',
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
    price: '$100',
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
    price: '$120',
    description: 'Interior and exterior detailing combined into one complete service.',
    image: '/images/work-6.webp',
    imageSmall: '/images/work-6-480.webp',
    alt: 'Detailed blue Jeep parked outside in Aledo, Texas',
    includes: ['Exterior Detail', 'Interior Detail'],
    featured: true,
  },
] as const;

export const addOns = ['Pet hair removal', 'Engine bay cleaning', 'Ceramic coating'] as const;
export const serviceAreas = ['Aledo', 'Weatherford', 'Willow Park', 'Fort Worth'] as const;

export const faqs = [
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
] as const;

export const galleryItems = [
  {
    id: 'mustang-hand-wash',
    category: 'exterior',
    title: 'Hands-on exterior care',
    caption: 'Cooper detailing the front of a blue Ford Mustang.',
    image: '/images/work-1.webp',
    thumbnail: '/images/work-1-480.webp',
    alt: 'Cooper hand detailing the front bumper of a blue Ford Mustang in a driveway',
  },
  {
    id: 'mustang-foam-wash',
    category: 'exterior',
    title: 'Foam wash',
    caption: 'Foam coverage during an exterior detail.',
    image: '/images/work-2.webp',
    thumbnail: '/images/work-2-480.webp',
    alt: 'Blue Ford Mustang covered in white foam during an exterior wash',
  },
  {
    id: 'mustang-finish',
    category: 'exterior',
    title: 'Glossy finish',
    caption: 'Clean reflections across the hood and front quarter panel.',
    image: '/images/work-3.webp',
    thumbnail: '/images/work-3-480.webp',
    alt: 'Close view of a glossy blue Ford Mustang hood and headlight after detailing',
  },
  {
    id: 'tan-interior',
    category: 'interior',
    title: 'Leather interior',
    caption: 'Detailed tan leather seating and interior surfaces.',
    image: '/images/work-4.webp',
    thumbnail: '/images/work-4-480.webp',
    alt: 'Clean tan leather rear seats and carpeting inside a vehicle',
  },
  {
    id: 'tan-cabin',
    category: 'interior',
    title: 'Cabin reset',
    caption: 'A clean, tidy passenger cabin.',
    image: '/images/work-5.webp',
    thumbnail: '/images/work-5-480.webp',
    alt: 'Clean tan leather passenger seating inside a vehicle',
  },
  {
    id: 'jeep-front',
    category: 'exterior',
    title: 'Jeep exterior',
    caption: 'Finished exterior work on a blue Jeep.',
    image: '/images/work-6.webp',
    thumbnail: '/images/work-6-480.webp',
    alt: 'Detailed blue Jeep viewed from the front passenger side',
  },
  {
    id: 'jeep-wheel',
    category: 'exterior',
    title: 'Wheel and fender',
    caption: 'Clean wheel, tire, and exterior trim details.',
    image: '/images/work-7.webp',
    thumbnail: '/images/work-7-480.webp',
    alt: 'Close view of a clean blue Jeep front fender, wheel, and tire',
  },
  {
    id: 'jeep-reflection',
    category: 'exterior',
    title: 'Clean reflections',
    caption: 'A clear reflection on a detailed blue door panel.',
    image: '/images/work-8.webp',
    thumbnail: '/images/work-8-480.webp',
    alt: 'Reflective blue Jeep door panel after exterior detailing',
  },
  {
    id: 'interior-before-after',
    category: 'before-after',
    title: 'Interior before and after',
    caption: 'The after view from the verified comparison set.',
    image: '/images/after-interior.webp',
    thumbnail: '/images/after-interior-420.webp',
    alt: 'Clean black rear seating after an interior detail',
  },
] as const;

export const galleryCategories = [
  { id: 'all', label: 'All work' },
  { id: 'exterior', label: 'Exterior' },
  { id: 'interior', label: 'Interior' },
  { id: 'before-after', label: 'Before & after' },
] as const;

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
      price: service.price.replace('$', ''),
      itemOffered: {
        '@type': 'Service',
        name: service.name,
        description: service.description,
      },
    })),
  },
};
