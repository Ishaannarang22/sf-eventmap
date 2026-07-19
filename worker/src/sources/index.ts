import type { Source } from '../types.ts';
import { ticketmaster } from './ticketmaster.ts';
import { seatgeek } from './seatgeek.ts';
import { eventbrite } from './eventbrite.ts';
import { luma } from './luma.ts';
import { funcheap } from './funcheap.ts';

// The whole Bay Area. bbox = [west, south, east, north].
export const BAY_AREA = {
  name: 'San Francisco Bay Area',
  bbox: [-122.75, 37.2, -121.7, 38.1] as [number, number, number, number],
};

// Register every connector here. Order doesn't matter; trustRank does the work.
export const SOURCES: Source[] = [
  ticketmaster,
  seatgeek,
  eventbrite,
  luma,
  funcheap,
];
