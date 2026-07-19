import type { Source, RawEvent, NormalizedEvent } from '../types.ts';

// SeatGeek Platform API — free client id. https://platform.seatgeek.com/
// TODO: implement fetch against https://api.seatgeek.com/2/events?lat=&lon=&range=40mi
export const seatgeek: Source = {
  key: 'seatgeek',
  name: 'SeatGeek',
  kind: 'api',
  trustRank: 20,

  async fetch(ctx): Promise<RawEvent[]> {
    const id = ctx.secrets.SEATGEEK_CLIENT_ID;
    if (!id) return [];
    // TODO: page api.seatgeek.com with client_id=id, lat/lon from ctx.region.
    return [];
  },

  normalize(raw: RawEvent): NormalizedEvent | null {
    const ev: any = raw.payload;
    if (!ev?.title || !ev?.datetime_local) return null;
    const v = ev.venue;
    return {
      title: ev.title,
      category: 'other', // TODO: map ev.type
      startAt: ev.datetime_utc ?? ev.datetime_local,
      tz: 'America/Los_Angeles',
      venue: v?.name,
      address: v?.address,
      lat: v?.location?.lat,
      lng: v?.location?.lon,
      url: ev.url,
      price: ev.stats?.lowest_price != null
        ? { min: ev.stats.lowest_price, free: false, currency: 'USD' }
        : undefined,
    };
  },
};
