// The token radar's model (radar-2): one sealed snapshot in, one ranked board out.
//
// The board ranks genuine pre-token candidates: the snapshot's watchlist (the floor) plus every
// protocol below the floor that the watchlist's own rule would call a candidate — it records no
// token, is not a wrapped, staked or bridged product of one that trades, is not an exchange, and
// its name carries no version marker. Protocols whose token already trades are never ranked; the
// largest of them are shown apart, with the market's own capitalisation, never a model's number.
//
// Implied value follows only from the snapshot's own figures, one function for every protocol:
//
//   size        = tvl_usd ^ 0.7                 (dampened: a 200x gap in TVL is a 41x gap in value;
//                                                token values do not scale linearly with size)
//   growth      = clamp(change_7d, -50, 150)     (a week's move, floored so one bad week cannot zero it)
//   growthMult  = 1 + growth / 100              (a +50% week doubles the score; a -50% week halves it)
//   maturity    = 0.7 + min(age, 1460) / 1460 * 0.65
//                                               (age is days since first listing; the longer a protocol
//                                                has run with no token, the more established its launch
//                                                would be. Unknown age counts as 365 days.)
//   breadth     = 1 + 0.02 * min(chains, 6)     (reach across chains, at most +12%)
//   implied     = round(200 * size * growthMult * maturity * breadth)
//
// No protocol name is ever special-cased: the same arithmetic scores every row, and the dashboard
// states the constants and recomputes each row from the same figures, so the page and board.json
// can be checked against each other.

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

/** The radar-2 constants, as the dashboard states them and the model lab may vary them. */
export interface ModelConstants {
  tvl_exponent: number;
  scale: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max: number;
}

export const MODEL: ModelConstants = {
  tvl_exponent: 0.7,
  scale: 200,
  growth_weight: 1.0,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.65,
  maturity_days: 1460,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_max: 6,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 40;

/** A farm step: the action, what it costs, and how long it takes. */
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
    tvl_exponent: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the farm plan is generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's value, not a model. */
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
  source: string;
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

/** Whole days from `listed` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${asOf}T00:00:00Z`);
  const first = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(first)) return null;
  return Math.max(0, Math.floor((start - first) / DAY_MS));
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function scoreProtocol(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): {
  implied: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.chain_step * Math.min(protocol.chains.length, model.chain_max);
  const size = Math.pow(protocol.tvl_usd, model.tvl_exponent);
  const implied = Math.max(1, Math.round(model.scale * size * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories the watchlist's rule reads as a wrapped, staked or bridged product of a traded token. */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** An exchange's name at the start of a protocol's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is a genuine token-launch candidate by the watchlist's own rule: it records no
 * token, is not a wrapped, staked or bridged product of one that trades, is not an exchange, and
 * its name carries no version marker. The watchlist applies this rule above the floor; the early
 * radar applies it below the floor, so the whole board is candidates of one kind.
 */
export function isCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const p of protocols) index.set(p.slug, p);
  return index;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every genuine candidate below the watchlist floor, all of them — not a
  // hand-picked top slice. A chosen protocol stays chosen.
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug)) continue;
    if (p.tvl_usd >= snapshot.floor_usd) continue;
    if (!isCandidate(p)) continue;
    chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const s = scoreProtocol(p, snapshot.as_of, model);
    return { p, ...s };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    token_status: 'pre-token' as const,
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      tvl_exponent: model.tvl_exponent,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, about, in dollars. */
function gasFor(chain: string): number {
  switch (chain) {
    case 'Ethereum':
      return 8;
    case 'Solana':
      return 0.02;
    case 'Arbitrum':
      return 0.3;
    case 'Optimism':
      return 0.25;
    case 'Base':
      return 0.1;
    case 'Binance':
      return 0.3;
    case 'Polygon':
      return 0.1;
    case 'Avalanche':
      return 0.8;
    case 'Hyperliquid L1':
      return 0.05;
    case 'Tron':
      return 1;
    case 'Linea':
      return 0.15;
    case 'Monad':
      return 0.05;
    case 'Plasma':
      return 0.1;
    default:
      return 1;
  }
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's first action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} as a lender, and leave it earning.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm')) {
    return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position open.`;
  }
  if (c.includes('yield aggregator') || c.includes('yield') || c.includes('allocator') || c.includes('curator')) {
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and hold the vault shares.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then put the bridged funds to work in its app.`;
  }
  if (c.includes('stak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetic')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  }
  if (c.includes('basis')) {
    return `Deposit $${capital} of USDC into ${name}'s basis position on ${chain} and hold it.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} and take one small position in an active market.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (c.includes('index')) {
    return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  }
  if (c.includes('launchpad')) {
    return `Stake $${capital} through ${name} on ${chain} to qualify, then join its next allocation.`;
  }
  if (c.includes('payment') || c.includes('card')) {
    return `Move $${capital} through ${name} on ${chain} and make one real payment with it.`;
  }
  if (c.includes('farm')) {
    return `Deposit $${capital} of USDC into ${name}'s farm on ${chain} and keep the position staked.`;
  }
  if (c.includes('locker')) {
    return `Lock $${capital} of tokens with ${name} on ${chain} for the shortest term it offers.`;
  }
  if (c.includes('privacy')) {
    return `Move $${capital} through ${name}'s private flow on ${chain} and keep the receipt.`;
  }
  if (c.includes('ai agent') || c.includes('decentralized ai')) {
    return `Spend $${capital} on ${name}'s agent service on ${chain} and run one real task through it.`;
  }
  if (c.includes('governance')) {
    return `Deposit $${capital} into ${name} on ${chain} and vote once with the position.`;
  }
  if (c.includes('chain')) {
    return `Bridge $${capital} of USDC to ${name}'s chain and use one of its apps with it.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second, weekly action: a different feature of the same protocol. */
function weeklyFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Borrow $25 against the supply on ${name} once a week, then repay it the same day.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm')) {
    return `Swap $25 through ${name}'s pool on ${chain} once a week, on a route you actually use.`;
  }
  if (c.includes('yield') || c.includes('allocator') || c.includes('curator')) {
    return `Claim or compound the vault's rewards on ${name} once a week, even when they are small.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $25 back through ${name} once a week so the flow runs in both directions.`;
  }
  if (c.includes('stak')) {
    return `Restake the staking rewards ${name} pays once a week instead of leaving them idle.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetic')) {
    return `Close the hedge and open a fresh one on ${name} once a week, keeping the margin small.`;
  }
  if (c.includes('basis')) {
    return `Check ${name}'s funding rate once a week and top up the position by $25 when it pays you.`;
  }
  if (c.includes('rwa')) {
    return `Reinvest the yield ${name} pays once a week by minting $25 more of the asset.`;
  }
  if (c.includes('prediction')) {
    return `Settle one market and open one new position on ${name} once a week.`;
  }
  if (c.includes('stable')) {
    return `Swap $25 into and out of the stable asset on ${name} once a week.`;
  }
  if (c.includes('insurance')) {
    return `Review the cover ${name} holds for you once a week and renew it before it lapses.`;
  }
  if (c.includes('index')) {
    return `Rebalance the index holding on ${name} by $25 once a week when its weights move.`;
  }
  if (c.includes('launchpad')) {
    return `Check ${name}'s upcoming allocations once a week and keep the qualifying stake in place.`;
  }
  if (c.includes('payment') || c.includes('card')) {
    return `Make one more real payment through ${name} each week, for something you would buy anyway.`;
  }
  if (c.includes('farm')) {
    return `Harvest and restake the farm's rewards on ${name} once a week.`;
  }
  if (c.includes('locker')) {
    return `Check the lock's release date on ${name} once a week and keep the terms unchanged.`;
  }
  if (c.includes('privacy')) {
    return `Run one more private transaction through ${name} each week, for a real use.`;
  }
  if (c.includes('ai agent') || c.includes('decentralized ai')) {
    return `Run one more task through ${name}'s agent service each week and keep the receipts.`;
  }
  if (c.includes('governance')) {
    return `Vote on ${name}'s next live proposal once a week, if one is open.`;
  }
  if (c.includes('chain')) {
    return `Use one app on ${name}'s chain each week with the bridged funds.`;
  }
  return `Make one qualifying action each week on ${name}, such as a deposit, a swap or a vote.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Amounts are illustrative: the point is a position a reader can actually open, not a sum.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gasText = gas >= 1 ? `$${gas}` : `$${gas.toFixed(2)}`;
  return [
    {
      text: `Open a fresh wallet for this farm alone and move only the funds you plan to use into it; send a $1 test transaction first and keep the seed phrase offline.`,
      cost: 'about $1 of gas for the test',
      time: '10 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about ${gasText} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p, capital, chain),
      cost: `about ${gasText} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Use a second feature of ${p.name} once, such as its rewards tab, its governance vote or its second pool, so the wallet is not a one-action address.`,
      cost: `about ${gasText} of gas`,
      time: '20 minutes',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity lands in more than one snapshot of the protocol.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own rewards or points page once a week, if it publishes one, and follow only the links it publishes there.`,
      cost: 'nothing to check',
      time: '5 minutes a week',
    },
    {
      text: `When you stop, withdraw, revoke the approvals you no longer need, and write the wallet, the dates and every transaction in a farm log.`,
      cost: 'claim gas only, and never pay anyone to claim',
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
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

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.tvl_usd !== 'number' ||
      !Number.isFinite(p.tvl_usd)
    ) {
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
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
