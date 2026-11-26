// Token radar model, version radar-2.
//
// Reads the sealed snapshot and scores every pre-token protocol the board may rank.
// Nothing here names a protocol: the same function scores every row, and every number
// it uses comes from the snapshot's own figures.
//
// The implied value of a launch is built in four steps:
//
//   peer multiple  = the median market-cap-to-TVL ratio of the live-token protocols
//                    in the same category (at least 3 peers, else the global median),
//                    clamped to [0.05, 2.00]. A category the market already values
//                    richly gives its pre-token peers a richer multiple.
//   growth factor  = 1 + clamp(change_7d, -50, +100) / 100 * 0.35
//                    (no 7-day change recorded counts as 0).
//   age factor     = 0.80 + min(age_days, 730) / 730 * 0.20 when listed_at is known,
//                    0.90 when it is not. A protocol that has run longer without a
//                    token has more to launch from; an unknown age stays near neutral.
//   breadth factor = 1 + min(chains - 1, 3) * 0.02. One more chain is a little more reach.
//
//   implied_value_usd = round(tvl_usd * peer multiple * growth * age * breadth),
//   at least $1.
//
// Live-token protocols are never mixed into the board: they are shown apart, at the
// market's own value, under "Live market". A protocol is pre-token when its record
// carries no market cap, no CoinGecko id and no symbol; the snapshot's record is not
// proof a token does not exist, so the board says "records no token", never "has none".

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  age_floor: number;
  age_range: number;
  age_days: number;
  unknown_age_factor: number;
  breadth_step: number;
  breadth_max: number;
  multiple_floor: number;
  multiple_cap: number;
  min_peers: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.35,
  growth_floor: -50,
  growth_cap: 100,
  age_floor: 0.8,
  age_range: 0.2,
  age_days: 730,
  unknown_age_factor: 0.9,
  breadth_step: 0.02,
  breadth_max: 3,
  multiple_floor: 0.05,
  multiple_cap: 2.0,
  min_peers: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the board carries. */
export const EARLY_ROWS = 60;

/** How many live-token protocols the Live market view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    age_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  growth_multiplier: number;
  age_multiplier: number;
  breadth_multiplier: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted list of numbers; null when the list is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The peer multiple for a category: the median mcap/TVL of the live-token protocols
 * in that category. Falls back to the global median when the category has fewer than
 * `min_peers` peers, and clamps to [multiple_floor, multiple_cap].
 */
export function peerMultiples(protocols: SnapshotProtocol[], model: ModelConstants): Map<string, { multiple: number; peers: number }> {
  const byCategory = new Map<string, number[]>();
  const global: number[] = [];
  for (const p of protocols) {
    if (p.category === 'CEX') continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    global.push(p.mcap_usd / p.tvl_usd);
    if (p.category !== null) {
      const list = byCategory.get(p.category) ?? [];
      list.push(p.mcap_usd / p.tvl_usd);
      byCategory.set(p.category, list);
    }
  }
  const globalMedian = median(global) ?? 0.2;
  const clamp = (n: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, n));
  const out = new Map<string, { multiple: number; peers: number }>();
  for (const [category, ratios] of byCategory) {
    if (ratios.length >= model.min_peers) {
      out.set(category, { multiple: clamp(median(ratios) ?? globalMedian), peers: ratios.length });
    } else {
      out.set(category, { multiple: clamp(globalMedian), peers: ratios.length });
    }
  }
  out.set('__global__', { multiple: clamp(globalMedian), peers: global.length });
  return out;
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, { multiple: number; peers: number }>,
  model: ModelConstants,
): { implied: number; peerMultiple: number; peerCount: number; growthPct: number; growthMult: number; ageMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const peer = protocol.category !== null
    ? multiples.get(protocol.category) ?? multiples.get('__global__')!
    : multiples.get('__global__')!;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageMult = age === null
    ? model.unknown_age_factor
    : model.age_floor + (Math.min(Math.max(age, 0), model.age_days) / model.age_days) * model.age_range;
  const breadthMult = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max) * model.breadth_step;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * peer.multiple * growthMult * ageMult * breadthMult));
  return { implied, peerMultiple: peer.multiple, peerCount: peer.peers, growthPct, growthMult, ageMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying a whole word wrapped, staked or staking. */
const WRAPPED_OR_STAKED = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/** Exchange names a protocol name must not begin with. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Categories that are a wrapped, staked or bridged product of another protocol, or an exchange. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool, not a wrapped, staked or bridged product. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_OR_STAKED.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const multiples = peerMultiples(snapshot.protocols, model);
  const scored = new Map<string, { p: SnapshotProtocol; implied: number; peerMultiple: number; peerCount: number; growthPct: number; growthMult: number; ageMult: number; breadthMult: number; age: number | null }>();
  const score = (p: SnapshotProtocol): void => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    scored.set(p.slug, { p, ...v });
  };
  // The watchlist is the floor: every slug it names, whatever its implied value.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) score(p);
  }
  // The early radar: the highest implied values among the rankable pre-token protocols
  // below the floor that the watchlist does not name.
  const early = snapshot.protocols
    .filter((p) => !scored.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, v: impliedValue(p, snapshot.as_of, multiples, model) }))
    .sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const { p } of early) score(p);

  const ranked = [...scored.values()].sort(
    (a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return ranked.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: round4(s.peerMultiple),
      peer_count: s.peerCount,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      age_multiplier: round4(s.ageMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}; time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  return 60;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The chain's native asset where it is well known, else a neutral phrase. */
const NATIVE_ASSET: Record<string, string> = {
  Ethereum: 'ETH', Solana: 'SOL', Bitcoin: 'BTC', Algorand: 'ALGO', Sui: 'SUI',
  Aptos: 'APT', Tron: 'TRX', Ripple: 'XRP', Stellar: 'XLM', Avalanche: 'AVAX',
  BSC: 'BNB', Binance: 'BNB', Polygon: 'POL', Cosmos: 'ATOM',
};
function nativeAsset(chain: string): string {
  return NATIVE_ASSET[chain] ?? "the chain's native asset";
}

/** Rough gas for one transaction on a chain, from the chain's own fee level. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $5–$15 of gas';
  if (chain === 'Bitcoin') return 'a few dollars of network fees';
  return 'under $1 of gas';
}

/** The possessive of a protocol name: names ending in s take only an apostrophe. */
function poss(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

/** "a" or "an" before a protocol name, by its first letter. */
function art(name: string): string {
  return /^[AEIOUaeiou]/.test(name) ? 'an' : 'a';
}

/** The category's core action, in the words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend')) return `Lend $${capital} of USDC into ${name} on ${chain} and leave it earning; the deposit is the position the farm is built on.`;
  if (c.includes('cdp')) return `Lock $${capital} of collateral through ${name} on ${chain} and mint its stablecoin; the minted stablecoin is the position the farm is built on.`;
  if (c.includes('dex')) return `Add $${capital} of liquidity to ${poss(name)} largest pool on ${chain} and keep the LP tokens in the farm wallet.`;
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('leveraged farm')) return `Deposit $${capital} into ${art(name)} ${name} vault on ${chain} and hold the vault shares in the farm wallet.`;
  if (c.includes('deriv') || c.includes('perpetual')) return `Deposit $${capital} of USDC as collateral on ${name} on ${chain} and open a small hedged position, then leave it alone.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside the destination app.`;
  if (c.includes('rwa')) return `Mint or buy $${capital} of ${poss(name)} yield-bearing asset on ${chain} and hold it in the farm wallet.`;
  if (c.includes('prediction')) return `Fund the wallet with $${capital} and take one small position in an open market on ${name}.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy in the farm wallet.`;
  if (c.includes('basis')) return `Open a delta-neutral basis position on ${name} on ${chain}: deposit $${capital} of USDC as margin, hold the long spot leg and the short perpetual leg together, and keep both legs open.`;
  if (c.includes('restak')) return `Restake $${capital} of BTC through ${name} on ${chain} and hold the restaked position in the farm wallet.`;
  if (c.includes('staking pool')) return `Stake $${capital} of ${nativeAsset(chain)} through ${name} on ${chain} and hold the staking position in the farm wallet.`;
  if (c.includes('anchor btc') || c.includes('decentralized btc')) return `Deposit $${capital} of BTC through ${name} on ${chain} and hold the BTC-anchored position in the farm wallet.`;
  if (c.includes('collateral')) return `Deposit $${capital} of collateral — a liquid staking token or USDC — into ${name} on ${chain} and keep it restaked in the farm wallet.`;
  if (c === 'chain') return `Bridge $${capital} of USDC onto ${chain} through ${name} and keep it deployed in ${name} on the chain, so the wallet is active where the protocol lives.`;
  if (c.includes('payments')) return `Fund the farm wallet with $${capital} of ${nativeAsset(chain)} on ${chain} and make a few small payments through ${name}, so the wallet shows real payment activity.`;
  if (c.includes('cedefi')) return `Deposit $${capital} of USDC into ${art(name)} ${name} vault on ${chain} and hold the vault shares in the farm wallet.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} of USDC into ${art(name)} ${name} managed liquidity vault on ${chain} and hold the vault shares in the farm wallet.`;
  if (c.includes('governance')) return `Deposit $${capital} of USDC into ${name} on ${chain}, then vote with the position in the next governance round, so the wallet shows both the deposit and the vote.`;
  if (c.includes('crypto card')) return `Fund the ${name} card account with $${capital} of USDC on ${chain}, then make one small card payment, so the wallet shows real card use.`;
  if (c.includes('farm')) return `Deposit $${capital} of USDC into the ${name} farm on ${chain} and hold the farm position in the farm wallet.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open in the farm wallet.`;
}

/** One extra step some categories earn, so a plan follows what the protocol actually does. */
function extraStep(p: SnapshotProtocol): FarmStep | null {
  const c = (p.category ?? '').toLowerCase();
  const gas = gasFor(chainOf(p));
  if (c.includes('cdp')) {
    return {
      text: `After two weeks, repay part of the minted stablecoin and mint it again at the same size, so the wallet shows the full mint–repay loop.`,
      cost: 'a few dollars of interest and gas',
      time: '15 minutes',
    };
  }
  if (c.includes('lend')) {
    return {
      text: `After two weeks, borrow a small amount — under a quarter of the deposit — against the position and repay it within a week, so the wallet shows both sides of the market.`,
      cost: 'a few dollars of interest and gas',
      time: '15 minutes',
    };
  }
  if (c.includes('dex')) {
    return {
      text: `Once a month, swap a small amount through the same pool — about $10 — so the wallet records trading volume as well as liquidity.`,
      cost: `about $10 swapped plus ${gas}`,
      time: '5 minutes',
    };
  }
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('leveraged farm')) {
    return {
      text: `After two weeks, move a quarter of the vault position into a second ${p.name} vault on the same chain, so the wallet touches more than one product.`,
      cost: gas,
      time: '10 minutes',
    };
  }
  if (c.includes('deriv') || c.includes('perpetual')) {
    return {
      text: `Once, close the hedge and reopen it at the same size, so the position shows a full round trip without changing direction.`,
      cost: gas,
      time: '10 minutes',
    };
  }
  if (c.includes('bridge')) {
    return {
      text: `Bridge a small amount back — about $25 — through ${p.name} so the wallet shows a round trip, not a one-way move.`,
      cost: gas,
      time: '10 minutes',
    };
  }
  if (c.includes('rwa')) {
    return {
      text: `Hold through one full yield distribution cycle before deciding anything, and record the payout in the farm log.`,
      cost: 'nothing',
      time: 'one cycle',
    };
  }
  return null;
}

/**
 * A protocol's farm plan: six steps, seven where the category earns an extra one.
 * Every step is derived from the protocol's own record (category, chains, TVL, age),
 * never from a hand-written list of names. Gas is rough and follows the chain's own
 * fee level: Ethereum mainnet costs real money per transaction, most other chains
 * cost under a dollar, Bitcoin costs a few dollars of network fees.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const steps: FarmStep[] = [
    {
      text: `Open a fresh wallet for this farm only, fund it with the amount below, and store its recovery phrase offline on paper. Never reuse a wallet that holds other positions.`,
      cost: `${gas} for the first transfer`,
      time: '10 minutes',
    },
    {
      text: coreAction(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: `Return once a week and do one real action — a deposit, a swap, a borrow, a vote or a claim — so the wallet shows repeated use instead of a single deposit.`,
      cost: `${gas} per week`,
      time: '10 minutes a week',
    },
    {
      text: `Keep the position open for at least ${hold} days, across more than one monthly snapshot, before you judge the farm or withdraw.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check the protocol's own rewards or points page — reached from its official site, never from a link in a chat — and claim only through the page it publishes.`,
      cost: 'free to check; never pay anyone to claim',
      time: '10 minutes',
    },
    {
      text: `Write down the wallet address, every transaction hash, the dates and the amounts in a farm log, so you can repeat the position or unwind it without guessing.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  const extra = extraStep(p);
  if (extra !== null) steps.splice(2, 0, extra);
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live market view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    growth_multiplier: row.model.growth_multiplier,
    age_multiplier: row.model.age_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    watchlist: watchlist.has(row.slug),
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, fewer than 100`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
