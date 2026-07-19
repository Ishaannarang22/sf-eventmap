import type { Source, RawEvent, NormalizedEvent } from '../types.ts';

// Eventbrite API. NOTE: public event search was removed; access is now
// org-scoped (your own org's events) + the public event detail endpoint.
// We treat it as best-effort. https://www.eventbrite.com/platform/api
// TODO: decide whether to use org token or fall back to scraping eventbrite city pages.
export const eventbrite: Source = {
  key: 'eventbrite',
  name: 'Eventbrite',
  kind: 'api',
  trustRank: 30,

  async fetch(ctx): Promise<RawEvent[]> {
    const token = ctx.secrets.EVENTBRITE_TOKEN;
    if (!token) return [];
    // TODO: implement against available endpoints / or scrape SF discovery pages.
    return [];
  },

  normalize(raw: RawEvent): NormalizedEvent | null {
    const ev: any = raw.payload;
    if (!ev?.name?.text || !ev?.start?.utc) return null;
    return {
      title: ev.name.text,
      description: ev.description?.text,
      category: 'other',
      startAt: ev.start.utc,
      endAt: ev.end?.utc,
      tz: ev.start.timezone ?? 'America/Los_Angeles',
      venue: ev.venue?.name,
      address: ev.venue?.address?.localized_address_display,
      lat: ev.venue?.latitude ? Number(ev.venue.latitude) : undefined,
      lng: ev.venue?.longitude ? Number(ev.venue.longitude) : undefined,
      url: ev.url,
      image: ev.logo?.url,
      price: ev.is_free ? { min: 0, free: true, currency: 'USD' } : undefined,
    };
  },
};
