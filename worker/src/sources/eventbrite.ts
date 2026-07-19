import type { Source, RawEvent, NormalizedEvent, Category } from '../types.ts';

// Eventbrite API v3. NOTE: the public event *search* endpoint was retired; access
// is now org-scoped. We authenticate with a private OAuth token (EVENTBRITE_TOKEN)
// and pull that account's own organizations' live events. Optionally pin a single
// org with EVENTBRITE_ORG_ID. Skips gracefully with no token.
// https://www.eventbrite.com/platform/api
const API = 'https://www.eventbriteapi.com/v3';

// Eventbrite top-level category ids -> our Category. https://www.eventbrite.com/platform/api#/reference/category
export function mapCategory(categoryId?: string): Category {
  switch (String(categoryId ?? '')) {
    case '103': return 'music';
    case '110': return 'food';
    case '105': return 'art';           // Performing & Visual Arts
    case '104': return 'art';           // Film, Media & Entertainment
    case '102': return 'tech';          // Science & Technology
    case '108': return 'sports';        // Sports & Fitness
    case '113': return 'community';
    case '115': return 'family';        // Family & Education
    case '116': return 'family';        // Holiday
    default: return 'other';
  }
}

export const eventbrite: Source = {
  key: 'eventbrite',
  name: 'Eventbrite',
  kind: 'api',
  trustRank: 30,

  async fetch(ctx): Promise<RawEvent[]> {
    const token = ctx.secrets.EVENTBRITE_TOKEN;
    if (!token) {
      console.log('[eventbrite] EVENTBRITE_TOKEN not set — skipping source.');
      return [];
    }
    const headers = { Authorization: `Bearer ${token}` };
    const max = ctx.maxItems ?? 1000;

    // Resolve which organizations to pull from.
    let orgIds: string[] = [];
    const pinned = ctx.secrets.EVENTBRITE_ORG_ID;
    if (pinned) {
      orgIds = [pinned];
    } else {
      const res = await fetch(`${API}/users/me/organizations/`, { headers });
      if (!res.ok) {
        console.error(`[eventbrite] org lookup HTTP ${res.status} — skipping.`);
        return [];
      }
      const json: any = await res.json();
      orgIds = (json?.organizations ?? []).map((o: any) => String(o.id));
    }
    if (orgIds.length === 0) {
      console.log('[eventbrite] token has no organizations — nothing to fetch.');
      return [];
    }

    const out: RawEvent[] = [];
    for (const org of orgIds) {
      let continuation: string | undefined;
      do {
        const url = new URL(`${API}/organizations/${org}/events/`);
        url.searchParams.set('expand', 'venue,ticket_availability,category');
        url.searchParams.set('status', 'live');
        url.searchParams.set('order_by', 'start_asc');
        if (continuation) url.searchParams.set('continuation', continuation);

        const res = await fetch(url, { headers });
        if (!res.ok) {
          console.error(`[eventbrite] events HTTP ${res.status} for org ${org}`);
          break;
        }
        const json: any = await res.json();
        for (const ev of json?.events ?? []) out.push({ sourceId: String(ev.id), url: ev.url, payload: ev });
        continuation = json?.pagination?.has_more_items ? json?.pagination?.continuation : undefined;
      } while (continuation && out.length < max);
      if (out.length >= max) break;
    }
    return out.slice(0, max);
  },

  normalize(raw: RawEvent): NormalizedEvent | null {
    const ev: any = raw.payload;
    if (!ev?.name?.text || !ev?.start?.utc) return null;
    const v = ev.venue;
    const minCents = ev.ticket_availability?.minimum_ticket_price?.value;
    const maxCents = ev.ticket_availability?.maximum_ticket_price?.value;
    const isFree = ev.is_free === true || ev.ticket_availability?.is_free === true;
    let price: NormalizedEvent['price'];
    if (isFree) price = { min: 0, free: true, currency: 'USD' };
    else if (minCents != null) {
      price = {
        min: Number(minCents) / 100,
        max: maxCents != null ? Number(maxCents) / 100 : undefined,
        free: false,
        currency: ev.ticket_availability?.minimum_ticket_price?.currency ?? 'USD',
      };
    }
    return {
      title: ev.name.text,
      description: ev.description?.text || undefined,
      category: mapCategory(ev.category_id ?? ev.category?.id),
      startAt: ev.start.utc,
      endAt: ev.end?.utc,
      tz: ev.start.timezone ?? 'America/Los_Angeles',
      venue: v?.name,
      address: v?.address?.localized_address_display,
      lat: v?.latitude ? Number(v.latitude) : undefined,
      lng: v?.longitude ? Number(v.longitude) : undefined,
      url: ev.url,
      image: ev.logo?.url,
      price,
    };
  },
};
