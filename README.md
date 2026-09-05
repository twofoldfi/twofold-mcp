<p align="center">
  <a href="https://twofold.fi">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://twofold.fi/brand/wordmark-light.png">
      <img src="https://twofold.fi/brand/wordmark-dark.png" alt="Twofold" width="360">
    </picture>
  </a>
</p>

<p align="center">
  <b>twofold-mcp</b> gives any AI agent a wallet and sixteen tools for
  <a href="https://twofold.fi">Twofold</a>, the dual-yield liquidity protocol
  on Robinhood Chain: trade, provide liquidity, stake.
</p>

<p align="center">
  <a href="https://twofold.fi/agents.html">twofold.fi/agents</a> ·
  <a href="https://twofold.fi/agents/SKILL.md">the agent skill</a> ·
  <a href="https://twofold.fi/docs.html">protocol docs</a>
</p>

---

## What it does

Sixteen tools over stdio. Each reply renders as terminal output, so you can
read the state your agent acted on at a glance:

```
│ TWO/USDG   │    $205.46 │ ████████████████████████ │ 325,505.92 TWO │
│ USDe/USDG  │    $150.00 │ ██████████████████░░░░░░ │    149.53 USDe │

TVL, last 30h:  ▁▂▂▂▂▂▂▁▂▁▂▂▂▂▃▄▅▁▃▇▇▇▇▇▇█████
```

| tool | what it does |
|---|---|
| `wallet_info` | the server's own wallet: address and balances |
| `wallet_send` | send ETH or any ERC-20 from that wallet |
| `pools_list` | every Twofold pool, reserves drawn as a depth chart |
| `pool_position` | your shares in a pool and what burning them returns |
| `pool_deposit` | two-sided deposit, sized on-chain, slippage-capped |
| `pool_withdraw` | burn shares, take both legs back |
| `quote` | price a swap without sending anything; `venue: reference` probes the chain's hookless pools (any pair, e.g. TWO/WETH) |
| `swap` | swap through a Twofold pool (or a reference pool via `venue`), quoted first, with a real minimum out |
| `stake` / `start_unstake` / `claim_unstaked` | the TWO staking cycle (1h cooldown) |
| `claim_rewards` / `staking_info` | streaming rewards and vault state |
| `rewards_stream` | live emission rate, days left, and what remains to distribute |
| `market_activity` | 24h volume per pair chain-wide, plus the latest vault flow |
| `platform_stats` | TVL bar chart, staking APY, a TVL sparkline |

## Quickstart

```sh
npx twofold-mcp        # or: npm i -g twofold-mcp
```

Register it with your MCP host. For Claude Code, put this in your project's
`.mcp.json`:

```json
{ "mcpServers": { "twofold": { "command": "npx", "args": ["-y", "twofold-mcp"] } } }
```

For Claude Desktop, add the same entry under `mcpServers` in
`claude_desktop_config.json`.

## The wallet

On first run the server generates a fresh private key and stores it at
`~/.twofold/wallet.key` (mode 600). It never imports or touches a key you
already own. Ask your agent for `wallet_info`, send that address a little ETH
for gas plus the USDG you want it to trade on **Robinhood Chain (chain id
4663)**, and the tools go live.

- `TWOFOLD_KEYFILE` moves the key somewhere else.
- `TWOFOLD_RPC` points at your own endpoint instead of the public
  `rpc.mainnet.chain.robinhood.com`.

## Safety model

- The wallet spends only what you send it.
- The server quotes each swap through the on-chain Quoter first and executes
  with a real `amountOutMinimum`, not zero.
- Deposits and withdrawals carry slippage caps on both legs, 0.50% by
  default.
- There is no backend and nothing custodial: the server talks straight to the
  chain, and whoever holds pool shares can burn them back to tokens.

## What Twofold is

Twofold pools pair tokenized equities (SPY, NVDA, TSLA, GME and more) and
other assets against USDG. Idle USDG earns lending yield in ERC-4626 vaults
while the same dollars quote swaps: one deposit, two yields. Live numbers:
[twofold.fi/stats](https://twofold.fi/stats.html).

---

<p align="center">
  Twofold · dual-yield liquidity infrastructure on Robinhood Chain ·
  not affiliated with Uniswap Labs or Robinhood
</p>
