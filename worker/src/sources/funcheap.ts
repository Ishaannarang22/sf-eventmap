import * as cheerio from 'cheerio';
import type { Source, RawEvent, NormalizedEvent } from '../types.ts';

// Funcheap SF — pure HTML scrape. High volume of small/free local events, which
// is exactly the "every local event" goal. Messy data: often no coords (geocoder
// fills them) and free-text times. https://sf.funcheap.com/
// TODO: walk the daily listing pages; this stub shows the shape.
export const funcheap: Source = {
  key: 'scrape:funcheap',
  name: 'Funcheap SF',
  kind: 'scrape',
  trustRank: 60,

  async fetch(_ctx): Promise<RawEvent[]> {
    // TODO: fetch https://sf.funcheap.com/ daily pages, parse each .tanbox/article.
    // Sketch of parsing one listing page:
    // const html = await (await fetch('https://sf.funcheap.com/')).text();
    // const $ = cheerio.load(html);
    // $('.tanbox .title a').each(...) -> { sourceId: href, url: href, payload: {...} }
    void cheerio;
    return [];
  },

  normalize(raw: RawEvent): NormalizedEvent | null {
    const ev: any = raw.payload;
    if (!ev?.title || !ev?.startAt) return null;
    return {
      title: ev.title,
      description: ev.description,
      category: ev.category ?? 'community',
      startAt: ev.startAt,
      tz: 'America/Los_Angeles',
      venue: ev.venue,
      address: ev.address,
      // no coords from Funcheap — geocoder resolves venue/address downstream
      url: raw.url,
      image: ev.image,
      price: ev.free ? { min: 0, free: true, currency: 'USD' } : undefined,
    };
  },
};
