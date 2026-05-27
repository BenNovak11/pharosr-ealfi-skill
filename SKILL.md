---
name: pharos-realfi-skill
description: Interact with RealFi products on the Pharos Network. Given a vault address (or one of the known Pharos RealFi vault aliases like "pAlpha"), this skill reads its full state — total assets, total shares, share price, underlying asset metadata — and optionally reports a specific holder's position (deposited shares, current asset value, profit or loss). Works on any ERC-4626 compliant vault, which is the standard used by Pharos RealFi vaults, yield farms, lending markets, and liquid staking products. Use whenever a user asks about a RealFi vault, RWA position, yield strategy, deposited assets on Pharos, a wallet's exposure to a vault, vault TVL, share price, or anything involving tokenized vault products on Pharos.
license: MIT
---

# Pharos RealFi Product Interaction Skill

A two-tier Agent Skill for reading RealFi products on the Pharos Network.

**Tier 1 (always works, no setup):** RPC-only — reads any ERC-4626 vault on Pharos, fetches share price, total assets, total supply, underlying asset metadata, and optionally a holder's full position with profit/loss in asset terms.

**Tier 2 (optional, with API key):** SocialScan ABI lookup adds the verified contract name and any custom view functions exposed by the vault (e.g. `apy()`, `strategy()`, `feeRecipient()`).

## Why ERC-4626

ERC-4626 is the universal standard for tokenized vaults on EVM chains. It's used across the Pharos RealFi ecosystem for:
- RWA vaults (including the pAlpha High Yield RWA Vault)
- Yield farming strategies
- Lending market deposits
- Liquid staking products
- Structured RealFi products

By targeting the standard rather than a single protocol, this one skill works on virtually every vault deployed on Pharos — present and future.

## When to use

Use this skill when the user wants to:
- See the current state of a RealFi vault (TVL, share price, underlying asset)
- Check a holder's deposited position and current value
- Compute profit or loss on a vault position
- Look up vault metadata (name, symbol, underlying token)
- Identify the standard a contract follows (ERC-4626 vs not)

## Inputs

1. **Vault address** — a 0x-prefixed contract address (or an alias like `pAlpha` — see the known-vaults table inside the script)

Optional:
- **Holder address** — if provided, the report also includes that wallet's position in the vault
- **Network** — `mainnet` (default, chain 1672) or `testnet` (chain 688689 Atlantic)
- **SOCIALSCAN_API_KEY** environment variable — unlocks the Tier 2 verified contract details

## How to run it

```bash
node scripts/check_realfi.js <vault> [holder] [network]
```

Examples:
```bash
# Just vault state
node scripts/check_realfi.js 0xabc...

# Vault state + holder position
node scripts/check_realfi.js 0xabc... 0xdef...

# Using a known alias
node scripts/check_realfi.js pAlpha 0xdef... mainnet

# With Tier 2 details
export SOCIALSCAN_API_KEY=your_key_here
node scripts/check_realfi.js 0xabc... 0xdef... mainnet
```

## Output format

```
Vault:          pAlpha High Yield RWA Vault
Address:        0xabc...
Network:        Pharos Pacific Ocean Mainnet
Standard:       ERC-4626 ✓

— Underlying asset —
Asset:          USDC (USD Coin)
Address:        0x123...
Decimals:       6

— Vault state —
Total assets:   12,453,200.50 USDC
Total shares:   12,103,872.41
Share price:    1.0288 USDC per share

— Holder position (0xdef...) —
Shares held:    5,000.00
Current value:  5,144.18 USDC
(Deposit history not available on-chain; P/L requires off-chain context)

Explorer:       https://pharosscan.xyz/address/0xabc...
```

If the contract is **not** ERC-4626, the script reports that cleanly and stops.

## Detection logic

- **ERC-4626 detection**: the script calls `asset()`, `totalAssets()`, and `convertToAssets(1e18)` — if all three succeed without reverting, the contract conforms to ERC-4626
- **Underlying asset metadata**: from the asset address, reads `name()`, `symbol()`, `decimals()`
- **Share price**: derived from `convertToAssets(10**shareDecimals)` to handle any decimal mismatch correctly
- **Holder position**: `balanceOf(holder)` for shares, then `convertToAssets(shares)` for current asset value
- **Tier 2**: when API key is set, fetches the vault's ABI from SocialScan, surfaces the verified contract name and any additional public view functions

## Edge cases

- **Non-ERC-4626 contract**: detected by `asset()` reverting; reports cleanly and exits
- **Unknown alias**: if user passes a name not in the known-vaults table, treated as a bad address
- **Asset is a non-ERC-20 token (e.g. native PROS)**: uses sensible defaults when `decimals()` reverts
- **Vault has zero supply**: share price calculation skipped, total assets still reported
- **Holder address invalid**: validated up front
- **SocialScan unreachable**: Tier 1 output still returned; Tier 2 section just shows the error

## Known vault aliases

The script ships with a small alias table for well-known Pharos RealFi vaults so users can refer to them by name (e.g. `pAlpha`). The table is intentionally short and easy to extend — just add new entries to the `KNOWN_VAULTS` object in `scripts/check_realfi.js`. Aliases are case-insensitive.

## Dependencies

- Node.js 18+
- `viem` (installed via `npm install`)

See `README.md` for setup.
