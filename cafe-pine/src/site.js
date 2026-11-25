// All copy, menu items, prices, hours and links. The page renders from this object.
// Address, hours and prices are placeholders: replace them with the real ones.
export const SITE = {
  name: 'Cafe Pine',
  tagline: 'Coffee at the edge of the woods.',
  address: '14 Hollow Pine Road, Cedar Falls',
  mapsQuery: '14 Hollow Pine Road Cedar Falls',
  phone: '(555) 014-7463',
  email: 'hello@cafepine.example',

  canopy: {
    intro: 'A small roastery and cafe, twelve minutes up the trail from the road. Scroll down through the trees.',
    ctaPrimary: { label: 'See the brew bar', href: '#menu' },
    ctaSecondary: { label: 'Find us', href: '#visit' },
    hint: 'Scroll to descend  ·  click a tree to shake it',
  },

  descent: [
    {
      label: '22 m · the canopy',
      title: 'Roasted with the door open.',
      body: 'We roast twice a week in a 5 kg drum, in small batches, with the door open to the trees. You can smell it from the trailhead on Tuesdays and Fridays.',
      tip: 'Click a pine to shake loose a cone',
    },
    {
      label: '9 m · the trunks',
      title: 'Beans from people we know.',
      body: 'Three farms, two continents, no middlemen we haven\'t had dinner with. We buy a whole harvest at a time, and when it\'s gone the menu changes.',
    },
    {
      label: '2 m · the floor',
      title: 'Spring water, slow fire.',
      body: 'Our water comes from the spring below the cabin and is filtered once. Pour-overs are made by hand, one cup at a time, which is why the line is sometimes long. Bring a book.',
    },
  ],

  blend: {
    label: 'House blend',
    title: 'Ridgeline',
    body: 'Medium roast, built to taste good black on a cold morning and still hold up under oat milk.',
    notes: ['Dark chocolate', 'Toasted pecan', 'Pine honey', 'Dried cherry'],
    spec: [
      ['Origin', 'Huila, Colombia · Sidama, Ethiopia'],
      ['Process', 'Washed and natural'],
      ['Roast', 'Medium, 11 min drop'],
      ['Bag', '340 g · $19'],
    ],
    hint: 'Drag the mug to spin it · tap for steam',
  },

  menu: {
    label: 'Brew bar',
    title: 'Pick a cup.',
    drinks: [
      {
        id: 'drip', name: 'Ridgeline drip', price: 3.75,
        notes: 'House blend, hand-poured, black.',
        layers: [['coffee', 1]],
      },
      {
        id: 'cortado', name: 'Smoke cortado', price: 4.25,
        notes: 'Double shot, equal part steamed milk.',
        layers: [['espresso', 0.5], ['milk', 0.5]],
      },
      {
        id: 'latte', name: 'Trail latte', price: 5.0,
        notes: 'Espresso, whole or oat, thin foam.',
        layers: [['espresso', 0.28], ['milk', 0.57], ['foam', 0.15]],
      },
      {
        id: 'capp', name: 'Spruce-tip cappuccino', price: 4.75,
        notes: 'Spruce-tip syrup we make in May.',
        layers: [['espresso', 0.3], ['milk', 0.3], ['foam', 0.4]],
      },
      {
        id: 'matcha', name: 'Moss matcha', price: 5.25,
        notes: 'Ceremonial matcha, oat milk, honey.',
        layers: [['matcha', 0.48], ['milk', 0.37], ['foam', 0.15]],
      },
      {
        id: 'chai', name: 'Ember chai', price: 4.75,
        notes: 'Black tea simmered with cardamom and smoked cinnamon.',
        layers: [['chai', 0.78], ['foam', 0.22]],
      },
    ],
  },

  visit: {
    label: 'After dark',
    title: 'Lanterns on till nine on Fridays.',
    body: 'Fire night every Friday: the cabin stays open late, the stove is lit, and someone usually brings a guitar.',
    perk: 'Bring your own cup, save $0.50.',
    // day index: 0 = Sunday. Times in 24h local time.
    hours: [
      { day: 'Monday', d: 1, open: '06:30', close: '17:00' },
      { day: 'Tuesday', d: 2, open: '06:30', close: '17:00' },
      { day: 'Wednesday', d: 3, open: '06:30', close: '17:00' },
      { day: 'Thursday', d: 4, open: '06:30', close: '17:00' },
      { day: 'Friday', d: 5, open: '06:30', close: '21:00' },
      { day: 'Saturday', d: 6, open: '07:30', close: '18:00' },
      { day: 'Sunday', d: 0, open: '07:30', close: '18:00' },
    ],
    hint: 'Move your pointer to call the fireflies · click to release more',
  },

  footer: {
    big: ['See you', 'on the <em>trail</em>.'],
    directions: 'Get directions',
    credit: 'Cafe Pine. Forest rendered live in your browser, no photos were harmed.',
  },
};

export const LIQUIDS = {
  coffee: { color: '#2A1A10', rough: 0.18 },
  espresso: { color: '#3B2416', rough: 0.22 },
  milk: { color: '#E9DCC6', rough: 0.45 },
  foam: { color: '#F5EEE2', rough: 0.95 },
  matcha: { color: '#8AA14B', rough: 0.4 },
  chai: { color: '#B9773F', rough: 0.3 },
};
