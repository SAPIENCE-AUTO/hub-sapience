import { z } from 'zod';
import { createEndpoint, Deals } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  authenticated: true,
  description: 'Backfill exchange rates for USD deals missing exchangeRate',
  inputSchema: z.object({}),
  outputSchema: z.object({
    updated: z.number(),
    skipped: z.number(),
    rates: z.array(z.object({ date: z.string(), rate: z.number(), dealCount: z.number() })),
  }),
  execute: async () => {
    // Fetch all USD deals without exchangeRate
    const { records: allUsd } = await Deals.findAll({
      filters: { currency: { contains: 'USD' } },
      limit: 2000,
    });
    const missing = allUsd.filter(d => !d.exchangeRate);
    if (missing.length === 0) return { updated: 0, skipped: 0, rates: [] };

    // Group by date
    const byDate = new Map<string, typeof missing>();
    for (const deal of missing) {
      const date = deal.approvalDate || new Date().toISOString().slice(0, 10);
      const arr = byDate.get(date) || [];
      arr.push(deal);
      byDate.set(date, arr);
    }

    // Fetch rates per unique date
    const rateCache = new Map<string, number>();
    for (const date of byDate.keys()) {
      let rate: number | null = null;
      try {
        const res = await fetch(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.json`);
        if (res.ok) {
          const json = await res.json() as { usd?: { mxn?: number } };
          if (json.usd?.mxn) rate = json.usd.mxn;
        }
      } catch {}
      if (!rate) {
        try {
          const res = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json');
          if (res.ok) {
            const json = await res.json() as { usd?: { mxn?: number } };
            if (json.usd?.mxn) rate = json.usd.mxn;
          }
        } catch {}
      }
      if (rate) rateCache.set(date, rate);
    }

    let updated = 0;
    let skipped = 0;
    const ratesOut: { date: string; rate: number; dealCount: number }[] = [];

    for (const [date, deals] of byDate.entries()) {
      const rate = rateCache.get(date);
      if (!rate) { skipped += deals.length; continue; }
      ratesOut.push({ date, rate, dealCount: deals.length });
      for (const deal of deals) {
        await Deals.update({ id: deal.id, record: { exchangeRate: rate } });
        updated++;
      }
    }

    return { updated, skipped, rates: ratesOut };
  },
});
