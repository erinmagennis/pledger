// GENERATED from verify/src by app/scripts/sync-verify.mjs. Do not edit here.
import { promises as dnsPromises } from 'node:dns';

/** mailauth resolver contract: (name, rrtype) => records. For TXT, string[][]. */
export type DnsResolver = (name: string, rrtype: string) => Promise<any>;

export const PUBLIC_DNS_SERVERS = ['8.8.8.8', '1.1.1.1'];

/**
 * Resolver that asks public DNS (8.8.8.8 / 1.1.1.1) instead of the local stub.
 * The local resolver fails on SendGrid's CNAME-delegated DKIM key, so TXT lookups
 * fall back to following CNAMEs by hand (max 5 hops).
 */
export function createPublicResolver(servers: string[] = PUBLIC_DNS_SERVERS): DnsResolver {
  const r = new dnsPromises.Resolver({ timeout: 5000, tries: 2 });
  r.setServers(servers);

  const resolveTxt = async (name: string, depth: number): Promise<string[][]> => {
    try {
      const txt = await r.resolveTxt(name);
      if (txt.length) return txt;
    } catch (err: any) {
      if (err?.code !== 'ENODATA' && err?.code !== 'ENOTFOUND') throw err;
      if (depth >= 5) throw err;
      let cnames: string[] = [];
      try {
        cnames = await r.resolveCname(name);
      } catch {
        throw err;
      }
      if (!cnames.length) throw err;
      return resolveTxt(cnames[0], depth + 1);
    }
    const e: any = new Error(`No TXT records for ${name}`);
    e.code = 'ENODATA';
    throw e;
  };

  return async (name: string, rrtype: string) => {
    switch (rrtype.toUpperCase()) {
      case 'TXT':
        return resolveTxt(name, 0);
      case 'CNAME':
        return r.resolveCname(name);
      case 'MX':
        return r.resolveMx(name);
      case 'A':
        return r.resolve4(name);
      case 'AAAA':
        return r.resolve6(name);
      default:
        return r.resolve(name, rrtype as any);
    }
  };
}
