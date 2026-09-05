#!/usr/bin/env node
// Twofold MCP server: pools, staking, swaps on Robinhood Chain, with its own
// wallet. Every tool answers in terminal-dressed ASCII: tables, bar charts,
// sparklines. The wallet key is generated on first use into wallet.key beside
// this file (chmod 600) — a fresh wallet of its own, never an existing key.
// Deps: npm i @modelcontextprotocol/sdk viem zod
// RPC: TWOFOLD_RPC env, else rpc.txt beside this file, else the public node.
import { readFileSync, writeFileSync, existsSync, chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createPublicClient, createWalletClient, http, parseAbi, getAddress,
  encodeAbiParameters, encodePacked, formatUnits, parseUnits,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const DIR = dirname(fileURLToPath(import.meta.url));

// ── chain wiring (mirrors script/topup-pools.mjs, the proven caller) ────────
const A = {
  router:  "0x8876789976dEcBfCbBbe364623C63652db8C0904",
  quoter:  "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  hook:    "0x127B3f3b7769f659C5eDBfF8b4005443f19FAAc0",
  weth:    "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  usdg:    "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  two:     "0x2A4a33A2163D005d8E7f1D9aC08d14c98db288d5",
  vault:   "0x06E463fDa4BEb4aA096142E673240aB9719fB3A9",
  // TWO_STAKING_ADDR
  usdgStaking: "0x9CF18bB1dD9AfBF75B579Cc0C473B2975c16E9e3",
};
const TOKENS = [
  { sym: "SPY",   addr: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C" },
  { sym: "NVDA",  addr: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" },
  { sym: "AAPL",  addr: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9" },
  { sym: "TSLA",  addr: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d" },
  { sym: "GOOGL", addr: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3" },
  { sym: "MSFT",  addr: "0xe93237C50D904957Cf27E7B1133b510C669c2e74" },
  { sym: "META",  addr: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35" },
  { sym: "AMZN",  addr: "0x12f190a9F9d7D37a250758b26824B97CE941bF54" },
  { sym: "PLTR",  addr: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A" },
  { sym: "COIN",  addr: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b" },
  { sym: "AMD",   addr: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC" },
  { sym: "INTC",  addr: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681" },
  { sym: "MU",    addr: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD" },
  { sym: "SNDK",  addr: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400" },
  { sym: "GME",   addr: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E" },
  { sym: "ORCL",  addr: "0xb0992820E760d836549ba69BC7598b4af75dEE03" },
  { sym: "COST",  addr: "0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2" },
  { sym: "QQQ",   addr: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68" },
  { sym: "SPCX",  addr: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa" },
  { sym: "TTWO",  addr: "0x5e81213613b6B86EaB4c6c50d718d34359459786" },
  { sym: "RDDT",  addr: "0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C" },
  { sym: "USDe",  addr: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34", fee: 100, sp: 1 },
  { sym: "WETH",  addr: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" },
  { sym: "TWO",   addr: "0x2A4a33A2163D005d8E7f1D9aC08d14c98db288d5", fee: 10000, sp: 200 },
];
const FEE = 3000, SPACING = 60;

const HOOK_ABI = parseAbi([
  "function addLiquidity((address,address,uint24,int24,address),uint256,uint256,uint256,uint256) returns (uint256,uint256)",
  "function removeLiquidity((address,address,uint24,int24,address),uint256,uint256,uint256,uint256) returns (uint256,uint256)",
  "function previewDeposit((address,address,uint24,int24,address),uint256) view returns (uint256,uint256)",
  "function previewWithdraw((address,address,uint24,int24,address),uint256) view returns (uint256,uint256)",
  "function getReserves((address,address,uint24,int24,address)) view returns (uint256,uint256)",
  "function sharesOf((address,address,uint24,int24,address),address) view returns (uint256)",
]);
const E20 = parseAbi([
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address,uint256) returns (bool)",
]);
const VAULT_ABI = parseAbi([
  "function stake(uint256)",
  "function startUnstake(uint256)",
  "function claimUnstaked()",
  "function claimRewards(address[])",
  "function earned(address,address) view returns (uint256)",
  "function staked(address) view returns (uint256)",
  "function pending(address) view returns (uint256,uint256)",
  "function totalStaked() view returns (uint256)",
  "function stakeToken() view returns (address)",
  "function cooldown() view returns (uint256)",
  "function rewardTokens(uint256) view returns (address)",
  "function rewardTokensLength() view returns (uint256)",
  "function streams(address) view returns (uint256,uint256,uint256,uint256,uint256)",
]);
const TS_ABI = parseAbi([
  "function stake(uint256)",
  "function startUnstake(uint256)",
  "function claimUnstaked()",
  "function claimRewards()",
  "function earned(address) view returns (uint256)",
  "function staked(address) view returns (uint256)",
  "function pending(address) view returns (uint256,uint256)",
  "function totalStaked() view returns (uint256)",
  "function cap() view returns (uint256)",
  "function stakingPaused() view returns (bool)",
  "function stream() view returns (uint256,uint256,uint256,uint256,uint256)",
]);
const P2_ABI = parseAbi([
  "function approve(address,address,uint160,uint48)",
  "function allowance(address,address,address) view returns (uint160,uint48,uint48)",
]);
const UR_ABI = parseAbi(["function execute(bytes,bytes[],uint256) payable"]);
const Q_ABI = parseAbi([
  "function quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes)) returns (uint256,uint256)",
]);
const POOL_KEY_ABI = { type: "tuple", components: [
  { name: "currency0", type: "address" }, { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] };
const EXACT_IN_SINGLE_ABI = { type: "tuple", components: [
  { ...POOL_KEY_ABI, name: "poolKey" }, { name: "zeroForOne", type: "bool" },
  { name: "amountIn", type: "uint128" }, { name: "amountOutMinimum", type: "uint128" },
  { name: "minHopPriceX36", type: "uint256" }, { name: "hookData", type: "bytes" }] };

// ── clients and the server's own wallet ─────────────────────────────────────
function rpcUrl() {
  if (process.env.TWOFOLD_RPC) return process.env.TWOFOLD_RPC;
  const f = join(DIR, "rpc.txt");
  if (existsSync(f)) return readFileSync(f, "utf8").trim().split("\n")[0];
  return "https://rpc.mainnet.chain.robinhood.com";
}
const chain = { id: 4663, name: "robinhood", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: { default: { http: [rpcUrl()] } } };
const pub = createPublicClient({ chain, transport: http(rpcUrl()) });

// key resolution: TWOFOLD_KEYFILE env, else a wallet.key already sitting
// beside this file, else ~/.twofold/wallet.key (created on first run) — a
// stable home even when the script itself lives in an npx cache.
function keyfilePath() {
  if (process.env.TWOFOLD_KEYFILE) return process.env.TWOFOLD_KEYFILE;
  const local = join(DIR, "wallet.key");
  if (existsSync(local)) return local;
  return join(homedir(), ".twofold", "wallet.key");
}
const KEYFILE = keyfilePath();
function loadAccount() {
  let pk;
  if (existsSync(KEYFILE)) {
    pk = readFileSync(KEYFILE, "utf8").match(/0x[0-9a-fA-F]{64}/)[0];
  } else {
    mkdirSync(dirname(KEYFILE), { recursive: true, mode: 0o700 });
    pk = generatePrivateKey();
    writeFileSync(KEYFILE, pk + "\n", { mode: 0o600 });
    chmodSync(KEYFILE, 0o600);
  }
  return privateKeyToAccount(pk);
}
const account = loadAccount();
const wal = createWalletClient({ account, chain, transport: http(rpcUrl()) });

// ── helpers ─────────────────────────────────────────────────────────────────
const MAXU = (1n << 256n) - 1n;
const arr = (k) => [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks];
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 1800);
const decCache = new Map([[A.usdg.toLowerCase(), 6]]);
async function dec(t) {
  const k = t.toLowerCase();
  if (!decCache.has(k))
    decCache.set(k, await pub.readContract({ address: t, abi: E20, functionName: "decimals" }));
  return decCache.get(k);
}
function token(symOrAddr) {
  const t = TOKENS.find((x) => x.sym.toLowerCase() === String(symOrAddr).toLowerCase());
  if (t) return t;
  if (/^0x[0-9a-fA-F]{40}$/.test(symOrAddr)) return { sym: symOrAddr.slice(0, 8), addr: getAddress(symOrAddr) };
  throw new Error(`unknown token '${symOrAddr}' — use one of: ${TOKENS.map((x) => x.sym).join(", ")} or an address`);
}
function poolKey(t) {
  const [c0, c1] = [getAddress(t.addr), getAddress(A.usdg)].sort((a, b) =>
    a.toLowerCase() < b.toLowerCase() ? -1 : 1);
  return { currency0: c0, currency1: c1, fee: t.fee ?? FEE, tickSpacing: t.sp ?? SPACING, hooks: A.hook };
}
async function send(req) {
  const nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
  const hash = await wal.writeContract({ ...req, nonce });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return hash;
}
async function ensureErc20Allowance(tok, spender, need) {
  const a = await pub.readContract({ address: tok, abi: E20, functionName: "allowance",
    args: [account.address, spender] });
  if (a < need) await send({ address: tok, abi: E20, functionName: "approve", args: [spender, MAXU] });
}
async function ensureRouterAllowance(tok, need) {
  await ensureErc20Allowance(tok, A.permit2, need);
  const [amt] = await pub.readContract({ address: A.permit2, abi: P2_ABI, functionName: "allowance",
    args: [account.address, tok, A.router] });
  if (BigInt(amt) < need)
    await send({ address: A.permit2, abi: P2_ABI, functionName: "approve",
      args: [tok, A.router, (1n << 160n) - 1n, (1n << 48n) - 1n] });
}
function v4SwapInput(key, zeroForOne, amountIn, minOut, tokenIn, tokenOut) {
  const actions = encodePacked(["uint8", "uint8", "uint8"], [0x06, 0x0b, 0x0f]);
  const swapParam = encodeAbiParameters([EXACT_IN_SINGLE_ABI], [{ poolKey: key, zeroForOne,
    amountIn, amountOutMinimum: minOut, minHopPriceX36: 0n, hookData: "0x" }]);
  const settleParam = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bool" }],
    [getAddress(tokenIn), 0n, true]);
  const takeParam = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [getAddress(tokenOut), 0n]);
  return encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], [actions, [swapParam, settleParam, takeParam]]);
}
async function quoteExactIn(key, zeroForOne, amountIn) {
  const { result } = await pub.simulateContract({ address: A.quoter, abi: Q_ABI,
    functionName: "quoteExactInputSingle",
    args: [[arr(key), zeroForOne, amountIn, "0x"]] });
  return BigInt(result[0]);
}
async function liveJson(path) {
  const r = await fetch(`https://twofold.fi/${path}`, { headers: { "Cache-Control": "no-cache" } });
  if (!r.ok) throw new Error(`twofold.fi/${path} -> ${r.status}`);
  return r.json();
}
// Our indexer. It knows every Registry pool, not just the hardcoded TOKENS
// list, and answers in one request instead of two chain reads per pool.
// Anything it cannot answer (or answers as stale) falls back to the chain.
async function api(path) {
  try {
    const r = await fetch(`https://twofold.fi/api/${path}`, { headers: { "Cache-Control": "no-cache" } });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.stale ? null : j;
  } catch { return null; }
}

// ── ASCII dressing ──────────────────────────────────────────────────────────
const fnum = (x, d = 2) => Number(x).toLocaleString("en-US", { maximumFractionDigits: d });
function tbl(headers, rows) {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (l, m, r) => l + w.map((x) => "─".repeat(x + 2)).join(m) + r;
  const row = (cells) => "│ " + cells.map((c, i) =>
    (typeof rows[0]?.[i] === "number" || /^[\d$.,%\-▁▂▃▄▅▆▇█ ]+$/.test(String(cells[i])))
      ? String(c).padStart(w[i]) : String(c).padEnd(w[i])).join(" │ ") + " │";
  return [line("┌", "┬", "┐"), row(headers), line("├", "┼", "┤"),
          ...rows.map((r) => row(r.map(String))), line("└", "┴", "┘")].join("\n");
}
function bar(v, max, width = 24) {
  const n = max > 0 ? Math.round((v / max) * width) : 0;
  return "█".repeat(n) + "░".repeat(width - n);
}
function spark(vals) {
  const g = "▁▂▃▄▅▆▇█", lo = Math.min(...vals), hi = Math.max(...vals);
  return vals.map((v) => g[hi === lo ? 0 : Math.round(((v - lo) / (hi - lo)) * 7)]).join("");
}
const short = (a) => a.slice(0, 6) + ".." + a.slice(-4);
const ok = (t) => ({ content: [{ type: "text", text: t }] });

// ── the server ──────────────────────────────────────────────────────────────
const server = new McpServer({ name: "twofold", version: "1.1.1" });

server.tool("wallet_info",
  "The MCP wallet: address, ETH and token balances. This wallet belongs to the MCP server alone; fund it before trading.",
  {},
  async () => {
    const eth = await pub.getBalance({ address: account.address });
    const watch = [["USDG", A.usdg], ["TWO", A.two], ["WETH", A.weth]];
    const rows = [["ETH", fnum(formatUnits(eth, 18), 6)]];
    for (const [sym, addr] of watch) {
      const b = await pub.readContract({ address: addr, abi: E20, functionName: "balanceOf", args: [account.address] });
      rows.push([sym, fnum(formatUnits(b, await dec(addr)), 6)]);
    }
    return ok([
      "╔═ TWOFOLD WALLET ══════════════════════════════════╗",
      `  ${account.address}`,
      "╚═══════════════════════════════════════════════════╝",
      tbl(["asset", "balance"], rows),
      eth === 0n ? "\n⚠ no gas — send ETH on Robinhood Chain (id 4663) to this address first" : "",
    ].join("\n"));
  });

server.tool("wallet_send",
  "Send ETH or an ERC20 from the MCP wallet. amount is human units.",
  { asset: z.string().describe("'ETH', a token symbol, or an ERC20 address"),
    to: z.string().describe("recipient address"),
    amount: z.string().describe("human amount, e.g. '1.5'") },
  async ({ asset, to, amount }) => {
    const dest = getAddress(to);
    let hash;
    if (asset.toUpperCase() === "ETH") {
      hash = await wal.sendTransaction({ to: dest, value: parseUnits(amount, 18) });
      await pub.waitForTransactionReceipt({ hash });
    } else {
      const t = token(asset);
      hash = await send({ address: t.addr, abi: E20, functionName: "transfer",
        args: [dest, parseUnits(amount, await dec(t.addr))] });
    }
    return ok(`✓ sent ${amount} ${asset.toUpperCase()} → ${short(dest)}\n  tx ${hash}`);
  });

server.tool("pools_list",
  "Every Twofold pool on the Registry with its reserves, drawn as a USDG-depth bar chart, plus the MCP wallet's share balance.",
  {},
  async () => {
    const rows = [];
    const feed = await api("pools");
    if (feed && feed.pools) {
      const mine = await api(`positions?address=${account.address}`);
      const shares = new Map();
      for (const p of (mine && mine.positions) || []) shares.set(String(p.poolId).toLowerCase(), (shares.get(String(p.poolId).toLowerCase()) || 0n) + BigInt(p.shares));
      for (const p of feed.pools) {
        if (!p.active || !p.reserves) continue;
        const usdgIs0 = String(p.currency0).toLowerCase() === A.usdg.toLowerCase();
        rows.push({
          sym: usdgIs0 ? p.sym1 : p.sym0,
          usdg: Number(formatUnits(BigInt(usdgIs0 ? p.reserves[0] : p.reserves[1]), 6)),
          tok: Number(formatUnits(BigInt(usdgIs0 ? p.reserves[1] : p.reserves[0]), usdgIs0 ? p.dec1 : p.dec0)),
          sh: shares.get(String(p.poolId).toLowerCase()) || 0n,
        });
      }
    }
    if (!rows.length) for (const t of TOKENS) {
      const key = poolKey(t);
      try {
        const [r0, r1] = await pub.readContract({ address: A.hook, abi: HOOK_ABI,
          functionName: "getReserves", args: [arr(key)] });
        const sh = await pub.readContract({ address: A.hook, abi: HOOK_ABI,
          functionName: "sharesOf", args: [arr(key), account.address] });
        const usdgIs0 = key.currency0.toLowerCase() === A.usdg.toLowerCase();
        const usdg = Number(formatUnits(usdgIs0 ? r0 : r1, 6));
        const tok = Number(formatUnits(usdgIs0 ? r1 : r0, await dec(t.addr)));
        rows.push({ sym: t.sym, usdg, tok, sh });
      } catch { rows.push({ sym: t.sym, usdg: -1, tok: 0, sh: 0n }); }
    }
    const max = Math.max(...rows.map((r) => r.usdg));
    return ok([
      `TWOFOLD POOLS · ${rows.filter((r) => r.usdg >= 0).length} live · hook ${short(A.hook)}`,
      tbl(["pool", "USDG depth", "", "token side", "my shares"],
        rows.map((r) => [ `${r.sym}/USDG`,
          r.usdg < 0 ? "—" : "$" + fnum(r.usdg),
          r.usdg < 0 ? "" : bar(r.usdg, max),
          r.usdg < 0 ? "not initialized" : fnum(r.tok, 4) + " " + r.sym,
          r.sh === 0n ? "·" : fnum(formatUnits(r.sh, 18), 4) ])),
    ].join("\n"));
  });

server.tool("pool_position",
  "The MCP wallet's position in one pool: shares and what burning them returns right now.",
  { pool: z.string().describe("token symbol of the pool, e.g. 'SPY'") },
  async ({ pool }) => {
    const t = token(pool); const key = poolKey(t);
    const sh = await pub.readContract({ address: A.hook, abi: HOOK_ABI, functionName: "sharesOf",
      args: [arr(key), account.address] });
    if (sh === 0n) return ok(`no position in ${t.sym}/USDG — pool_deposit opens one`);
    const [a0, a1] = await pub.readContract({ address: A.hook, abi: HOOK_ABI, functionName: "previewWithdraw",
      args: [arr(key), sh] });
    const usdgIs0 = key.currency0.toLowerCase() === A.usdg.toLowerCase();
    const d = await dec(t.addr);
    return ok(tbl(["", t.sym + "/USDG"], [
      ["shares", fnum(formatUnits(sh, 18), 6)],
      ["→ " + t.sym, fnum(formatUnits(usdgIs0 ? a1 : a0, d), 6)],
      ["→ USDG", fnum(formatUnits(usdgIs0 ? a0 : a1, 6), 2)],
    ]));
  });

server.tool("pool_deposit",
  "Two-sided deposit into a pool from the MCP wallet. Sizes shares from the amounts, approves the hook, and caps slippage.",
  { pool: z.string().describe("token symbol, e.g. 'SPY'"),
    token_amount: z.string().describe("max token-side amount, human units"),
    usdg_amount: z.string().describe("max USDG-side amount, human units"),
    slippage_bps: z.number().int().min(1).max(1000).default(50) },
  async ({ pool, token_amount, usdg_amount, slippage_bps }) => {
    const t = token(pool); const key = poolKey(t); const d = await dec(t.addr);
    const wantTok = parseUnits(token_amount, d), wantUsdg = parseUnits(usdg_amount, 6);
    const usdgIs0 = key.currency0.toLowerCase() === A.usdg.toLowerCase();
    const [want0, want1] = usdgIs0 ? [wantUsdg, wantTok] : [wantTok, wantUsdg];
    const probe = 10n ** 18n;
    const [p0, p1] = await pub.readContract({ address: A.hook, abi: HOOK_ABI, functionName: "previewDeposit",
      args: [arr(key), probe] });
    if (p0 === 0n || p1 === 0n) throw new Error("pool has no depth to price against");
    const shares = (want0 * probe / p0 < want1 * probe / p1 ? want0 * probe / p0 : want1 * probe / p1);
    if (shares === 0n) throw new Error("amounts too small for one share");
    const [n0, n1] = await pub.readContract({ address: A.hook, abi: HOOK_ABI, functionName: "previewDeposit",
      args: [arr(key), shares] });
    const pad = (x) => x + (x * BigInt(slippage_bps)) / 10000n;
    await ensureErc20Allowance(key.currency0, A.hook, pad(n0));
    await ensureErc20Allowance(key.currency1, A.hook, pad(n1));
    const hash = await send({ address: A.hook, abi: HOOK_ABI, functionName: "addLiquidity",
      args: [arr(key), shares, pad(n0), pad(n1), deadline()] });
    return ok([
      `✓ deposited into ${t.sym}/USDG`,
      tbl(["", "amount"], [
        [t.sym, fnum(formatUnits(usdgIs0 ? n1 : n0, d), 6)],
        ["USDG", fnum(formatUnits(usdgIs0 ? n0 : n1, 6), 2)],
        ["shares", fnum(formatUnits(shares, 18), 6)]]),
      `tx ${hash}`,
    ].join("\n"));
  });

server.tool("pool_withdraw",
  "Burn pool shares from the MCP wallet and take both legs back, slippage-capped.",
  { pool: z.string(), shares: z.string().describe("shares to burn, human units, or 'all'"),
    slippage_bps: z.number().int().min(1).max(1000).default(50) },
  async ({ pool, shares, slippage_bps }) => {
    const t = token(pool); const key = poolKey(t);
    const have = await pub.readContract({ address: A.hook, abi: HOOK_ABI, functionName: "sharesOf",
      args: [arr(key), account.address] });
    const burn = shares === "all" ? have : parseUnits(shares, 18);
    if (burn === 0n || burn > have) throw new Error(`have ${formatUnits(have, 18)} shares, asked ${shares}`);
    const [a0, a1] = await pub.readContract({ address: A.hook, abi: HOOK_ABI, functionName: "previewWithdraw",
      args: [arr(key), burn] });
    const cut = (x) => x - (x * BigInt(slippage_bps)) / 10000n;
    const hash = await send({ address: A.hook, abi: HOOK_ABI, functionName: "removeLiquidity",
      args: [arr(key), burn, cut(a0), cut(a1), deadline()] });
    const usdgIs0 = key.currency0.toLowerCase() === A.usdg.toLowerCase();
    return ok(`✓ burned ${formatUnits(burn, 18)} shares of ${t.sym}/USDG → ~${fnum(formatUnits(usdgIs0 ? a1 : a0, await dec(t.addr)), 6)} ${t.sym} + ~${fnum(formatUnits(usdgIs0 ? a0 : a1, 6), 2)} USDG\ntx ${hash}`);
  });

server.tool("quote",
  "Price a swap without sending anything. venue 'twofold' (default) uses our hook pools vs USDG; 'reference' probes the chain's hookless pools and covers any pair (e.g. TWO/WETH).",
  { sell: z.string().describe("token symbol or 'USDG'"), buy: z.string(), amount: z.string(),
    venue: z.enum(["twofold", "reference"]).default("twofold") },
  async ({ sell, buy, amount, venue }) => {
    const { key, zeroForOne, tin, tout, tSym } = await swapRoute(sell, buy, venue);
    const din = await dec(tin), dout = await dec(tout);
    const amtIn = parseUnits(amount, din);
    const out = await quoteExactIn(key, zeroForOne, amtIn);
    const px = Number(formatUnits(out, dout)) / Number(formatUnits(amtIn, din));
    return ok(`${amount} ${sell.toUpperCase()} → ${fnum(formatUnits(out, dout), 6)} ${buy.toUpperCase()}   (1 ${sell.toUpperCase()} ≈ ${fnum(px, 6)} ${buy.toUpperCase()}, pool ${tSym} fee ${key.fee / 10000}%)`);
  });

const REF_TIERS = [[100, 1], [500, 10], [1000, 10], [2500, 25], [3000, 60], [5000, 50], [7500, 75], [10000, 100], [10000, 200]];
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const refKeyCache = new Map();
async function refPoolKey(tinAddr, toutAddr) {
  const [c0, c1] = [getAddress(tinAddr), getAddress(toutAddr)].sort((a, b) =>
    a.toLowerCase() < b.toLowerCase() ? -1 : 1);
  const ck = c0 + c1;
  if (refKeyCache.has(ck)) return refKeyCache.get(ck);
  const zeroForOne = c0.toLowerCase() === tinAddr.toLowerCase();
  const probeIn = 10n ** BigInt(await dec(tinAddr));
  let best = null;
  for (const [fee, tickSpacing] of REF_TIERS) {
    const key = { currency0: c0, currency1: c1, fee, tickSpacing, hooks: ZERO_ADDR };
    try {
      const out = await quoteExactIn(key, zeroForOne, probeIn);
      if (out > 0n && (!best || out > best.out)) best = { key, out };
    } catch {}
  }
  if (!best) throw new Error("no reference pool for this pair at any known tier (100/1, 500/10, 1000/10, 2500/25, 3000/60, 5000/50, 7500/75, 10000/100, 10000/200)");
  refKeyCache.set(ck, best.key);
  return best.key;
}

async function swapRoute(sell, buy, venue) {
  const s = sell.toUpperCase() === "USDG", b = buy.toUpperCase() === "USDG";
  if (s && b) throw new Error("sell and buy are both USDG");
  const useHook = (venue ?? "twofold") === "twofold" && s !== b;
  const tin = s ? A.usdg : token(sell).addr, tout = b ? A.usdg : token(buy).addr;
  const tSym = useHook ? `${token(s ? buy : sell).sym}/USDG` : `${sell.toUpperCase()}/${buy.toUpperCase()} reference`;
  const key = useHook ? poolKey(token(s ? buy : sell)) : await refPoolKey(tin, tout);
  const zeroForOne = key.currency0.toLowerCase() === tin.toLowerCase();
  return { key, zeroForOne, tin, tout, tSym };
}

server.tool("swap",
  "Swap from the MCP wallet: quotes first, executes with a real minimum-out. venue 'twofold' (default) uses our hook pools vs USDG; 'reference' uses the chain's hookless pools and covers any pair (e.g. TWO/WETH).",
  { sell: z.string(), buy: z.string(), amount: z.string().describe("amount of the sell token, human units"),
    slippage_bps: z.number().int().min(1).max(1000).default(100),
    venue: z.enum(["twofold", "reference"]).default("twofold") },
  async ({ sell, buy, amount, slippage_bps, venue }) => {
    const { key, zeroForOne, tin, tout, tSym } = await swapRoute(sell, buy, venue);
    const din = await dec(tin), dout = await dec(tout);
    const amtIn = parseUnits(amount, din);
    const quoted = await quoteExactIn(key, zeroForOne, amtIn);
    const minOut = quoted - (quoted * BigInt(slippage_bps)) / 10000n;
    await ensureRouterAllowance(tin, amtIn);
    const input = v4SwapInput(key, zeroForOne, amtIn, minOut, tin, tout);
    const nonce = await pub.getTransactionCount({ address: account.address, blockTag: "pending" });
    const hash = await wal.writeContract({ address: A.router, abi: UR_ABI, functionName: "execute",
      args: [encodePacked(["uint8"], [0x10]), [input], deadline()], nonce });
    const r = await pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error(`swap reverted: ${hash}`);
    return ok([
      `✓ swap on ${tSym}`,
      tbl(["", ""], [
        ["sold", `${fnum(amount, 6)} ${sell.toUpperCase()}`],
        ["quoted", `${fnum(formatUnits(quoted, dout), 6)} ${buy.toUpperCase()}`],
        ["min out", `${fnum(formatUnits(minOut, dout), 6)} ${buy.toUpperCase()}`]]),
      `tx ${hash}`,
    ].join("\n"));
  });

server.tool("staking_info",
  "The TWO staking vault: the MCP wallet's stake, pending unstake, claimable rewards, and vault totals.",
  {},
  async () => {
    const read = (fn, args = []) => pub.readContract({ address: A.vault, abi: VAULT_ABI, functionName: fn, args });
    const [mine, [pAmt, pUnlock], total, cd, nTok] = await Promise.all([
      read("staked", [account.address]), read("pending", [account.address]),
      read("totalStaked"), read("cooldown"), read("rewardTokensLength")]);
    const rows = [
      ["my stake", fnum(formatUnits(mine, 18), 4) + " TWO"],
      ["vault total", fnum(formatUnits(total, 18), 2) + " TWO"],
      ["cooldown", Number(cd) / 3600 + "h"],
    ];
    if (pAmt > 0n) {
      const left = Number(pUnlock) - Math.floor(Date.now() / 1000);
      rows.push(["unstaking", `${fnum(formatUnits(pAmt, 18), 4)} TWO ${left > 0 ? `(claimable in ${Math.ceil(left / 60)}m)` : "(claimable NOW)"}`]);
    }
    for (let i = 0n; i < nTok; i++) {
      const rt = await read("rewardTokens", [i]);
      const e = await read("earned", [account.address, rt]);
      const known = { [A.usdg.toLowerCase()]: "USDG", [A.two.toLowerCase()]: "TWO", [A.weth.toLowerCase()]: "WETH" };
      const sym = known[rt.toLowerCase()] || TOKENS.find((x) => x.addr.toLowerCase() === rt.toLowerCase())?.sym || short(rt);
      rows.push([`earned ${sym}`, fnum(formatUnits(e, await dec(rt)), 6)]);
    }
    return ok("STAKING VAULT " + short(A.vault) + "\n" + tbl(["", ""], rows));
  });

server.tool("stake",
  "Stake TWO from the MCP wallet into the streaming vault.",
  { amount: z.string().describe("TWO to stake, human units") },
  async ({ amount }) => {
    const amt = parseUnits(amount, 18);
    await ensureErc20Allowance(A.two, A.vault, amt);
    const hash = await send({ address: A.vault, abi: VAULT_ABI, functionName: "stake", args: [amt] });
    return ok(`✓ staked ${amount} TWO\ntx ${hash}`);
  });

server.tool("start_unstake",
  "Begin unstaking TWO (starts the vault cooldown; claim with claim_unstaked after it passes).",
  { amount: z.string() },
  async ({ amount }) => {
    const hash = await send({ address: A.vault, abi: VAULT_ABI, functionName: "startUnstake",
      args: [parseUnits(amount, 18)] });
    return ok(`✓ unstake of ${amount} TWO started — claim after the cooldown\ntx ${hash}`);
  });

server.tool("claim_unstaked",
  "Claim TWO whose unstake cooldown has passed.", {},
  async () => {
    const hash = await send({ address: A.vault, abi: VAULT_ABI, functionName: "claimUnstaked", args: [] });
    return ok(`✓ unstaked TWO claimed\ntx ${hash}`);
  });

server.tool("claim_rewards",
  "Claim all streaming rewards the MCP wallet has earned in the vault.", {},
  async () => {
    const n = await pub.readContract({ address: A.vault, abi: VAULT_ABI, functionName: "rewardTokensLength" });
    const toks = [];
    for (let i = 0n; i < n; i++)
      toks.push(await pub.readContract({ address: A.vault, abi: VAULT_ABI, functionName: "rewardTokens", args: [i] }));
    if (!toks.length) return ok("vault has no reward tokens yet");
    const hash = await send({ address: A.vault, abi: VAULT_ABI, functionName: "claimRewards", args: [toks] });
    return ok(`✓ rewards claimed across ${toks.length} token(s)\ntx ${hash}`);
  });

server.tool("usdg_staking_info",
  "The USDG staking vault (stake TWO, earn USDG): the MCP wallet's stake, USDG earned, pending exit, and the vault's fill, cap and daily USDG rate.",
  {},
  async () => {
    const read = (fn, args = []) => pub.readContract({ address: A.usdgStaking, abi: TS_ABI, functionName: fn, args });
    const [mine, e, [pAmt, pUnlock], total, cap, paused, s] = await Promise.all([
      read("staked", [account.address]), read("earned", [account.address]), read("pending", [account.address]),
      read("totalStaked"), read("cap"), read("stakingPaused"), read("stream")]);
    const perDay = (s[0] * 86400n) / 10n ** 27n;
    const left = Number(s[1]) - Math.floor(Date.now() / 1000);
    const rows = [
      ["my stake", fnum(formatUnits(mine, 18), 4) + " TWO"],
      ["USDG earned", fnum(formatUnits(e, 6), 4) + " USDG"],
      ["vault staked", `${fnum(formatUnits(total, 18), 2)} / ${fnum(formatUnits(cap, 18), 0)} TWO (${cap > 0n ? fnum(Number(total * 10000n / cap) / 100, 2) : "0"}% of cap)`],
      ["USDG per day", fnum(formatUnits(perDay, 6), 2)],
      ["stream ends", left > 0 ? `in ${Math.ceil(left / 3600)}h` : "ended (fill needed)"],
      ["staking", paused ? "PAUSED" : total >= cap ? "FULL" : "open"],
      ["exit cooldown", "7d"],
    ];
    if (pAmt > 0n) {
      const l = Number(pUnlock) - Math.floor(Date.now() / 1000);
      rows.push(["unstaking", `${fnum(formatUnits(pAmt, 18), 4)} TWO ${l > 0 ? `(withdraw in ${Math.ceil(l / 3600)}h)` : "(withdraw NOW)"}`]);
    }
    return ok("USDG STAKING " + short(A.usdgStaking) + "\n" + tbl(["", ""], rows));
  });

server.tool("usdg_stake",
  "Stake TWO from the MCP wallet into the USDG staking vault (7-day exit cooldown, USDG rewards claimable any time).",
  { amount: z.string().describe("TWO to stake, human units") },
  async ({ amount }) => {
    const amt = parseUnits(amount, 18);
    await ensureErc20Allowance(A.two, A.usdgStaking, amt);
    const hash = await send({ address: A.usdgStaking, abi: TS_ABI, functionName: "stake", args: [amt] });
    return ok(`✓ staked ${amount} TWO in the USDG vault\ntx ${hash}`);
  });

server.tool("usdg_start_unstake",
  "Begin unstaking TWO from the USDG vault. Queued TWO stops earning; a second call adds to the queue and restarts the 7 days for all of it.",
  { amount: z.string() },
  async ({ amount }) => {
    const hash = await send({ address: A.usdgStaking, abi: TS_ABI, functionName: "startUnstake", args: [parseUnits(amount, 18)] });
    return ok(`✓ unstake of ${amount} TWO queued; withdraw with usdg_claim_unstaked after 7 days\ntx ${hash}`);
  });

server.tool("usdg_claim_unstaked",
  "Withdraw TWO from the USDG vault whose 7-day cooldown has passed.", {},
  async () => {
    const hash = await send({ address: A.usdgStaking, abi: TS_ABI, functionName: "claimUnstaked", args: [] });
    return ok(`✓ TWO withdrawn\ntx ${hash}`);
  });

server.tool("usdg_claim",
  "Claim all USDG the MCP wallet has earned in the USDG staking vault.", {},
  async () => {
    const hash = await send({ address: A.usdgStaking, abi: TS_ABI, functionName: "claimRewards", args: [] });
    return ok(`✓ USDG claimed\ntx ${hash}`);
  });

server.tool("rewards_stream",
  "The vault's live reward streams: emission rate per day, time left, and what remains to be distributed.",
  {},
  async () => {
    const read = (fn, args = []) => pub.readContract({ address: A.vault, abi: VAULT_ABI, functionName: fn, args });
    const n = await read("rewardTokensLength");
    if (n === 0n) return ok("vault has no reward tokens yet");
    const PREC = 10n ** 27n;
    const now = BigInt(Math.floor(Date.now() / 1000));
    const rows = [];
    for (let i = 0n; i < n; i++) {
      const rt = await read("rewardTokens", [i]);
      const [rate, finish, , , unallocated] = await read("streams", [rt]);
      const d = await dec(rt);
      const known = { [A.usdg.toLowerCase()]: "USDG", [A.two.toLowerCase()]: "TWO", [A.weth.toLowerCase()]: "WETH" };
      const sym = known[rt.toLowerCase()] || TOKENS.find((x) => x.addr.toLowerCase() === rt.toLowerCase())?.sym || short(rt);
      const live = finish > now;
      const perDay = (rate * 86400n) / PREC;
      const remaining = (live ? rate * (finish - now) : 0n) / PREC + unallocated / PREC;
      rows.push([sym,
        live ? fnum(formatUnits(perDay, d), 2) + "/day" : "ended",
        live ? fnum(Number(finish - now) / 86400, 2) + "d left" : "—",
        fnum(formatUnits(remaining, d), 2)]);
    }
    return ok("REWARD STREAMS · vault " + short(A.vault) + "\n" +
      tbl(["token", "emission", "ends", "remaining"], rows));
  });

server.tool("market_activity",
  "Where the volume is: 24h trading volume per reference pair on the chain (from the twofold.fi feed), plus the latest vault deposits and withdrawals.",
  {},
  async () => {
    const live = await liveJson("live.json");
    const pairs = live.pairs || {}, idx = live.pools_index || [];
    const symOf = {};
    for (const p of idx) symOf[p.pair] = `${p.sym0}/${p.sym1}`;
    const rows = Object.entries(pairs)
      .map(([pair, v]) => ({ name: symOf[pair] || short(pair.split("_")[0]), vol: v.vol24h || 0, tvl: v.tvl || 0 }))
      .sort((a, b) => b.vol - a.vol);
    const max = Math.max(...rows.map((r) => r.vol), 1);
    const feed = (live.feed || []).slice(0, 8);
    return ok([
      `MARKET ACTIVITY · ${live.pairs_window_h || 24}h window · chain-wide reference pools`,
      tbl(["pair", "24h volume", "", "pair TVL"],
        rows.map((r) => [r.name, "$" + fnum(r.vol), bar(r.vol, max), "$" + fnum(r.tvl)])),
      "",
      "LATEST VAULT FLOW",
      ...feed.map((f) => `  ${f.kind === "deposit" ? "▲" : "▼"} ${f.amount}  ${Math.round(f.age_s / 60)}m ago  ${f.tx_short}`),
    ].join("\n"));
  });

server.tool("platform_stats",
  "Twofold platform dashboard: USDG vault TVLs as a bar chart, the staking APY, and a TVL sparkline over recent days.",
  {},
  async () => {
    const [live, hist] = await Promise.all([liveJson("live.json"), liveJson("live-history.json")]);
    const s = live.stats, vs = live.vaults || [];
    const max = Math.max(...vs.map((v) => v.tvl));
    const totals = hist.slice(-48).map((h) => h.total);
    return ok([
      "╔═ TWOFOLD · ROBINHOOD CHAIN ═══════════════════════════════╗",
      `  block ${live.block} · vault APY ${s.vault_apy}% (${fnum(s.vault_apy_window_h, 0)}h window) · share price ${s.vault_share_price}`,
      "╚═══════════════════════════════════════════════════════════╝",
      tbl(["USDG vault", "TVL", ""], vs.map((v) => [v.name, "$" + fnum(v.tvl), bar(v.tvl, max)])),
      `total $${fnum(s.vaults_total_usdg)} across ${s.vaults_reporting} vaults`,
      ``,
      `TVL, last ${totals.length}h:  ${spark(totals)}`,
      `  ${fnum(totals[0])} → ${fnum(totals[totals.length - 1])}`,
    ].join("\n"));
  });

const transport = new StdioServerTransport();
await server.connect(transport);
