# Pharos RealFi Product Interaction Skill

An [Agent Skill](https://agentskills.io) for interacting with RealFi products on the [Pharos Network](https://www.pharos.xyz). Built for the **Pharos Agent Center Skill Builder Campaign**.

Reads any **ERC-4626 vault** on Pharos and (optionally) a holder's position in it. ERC-4626 is the universal standard for tokenized vaults — it's what RealFi RWA vaults, yield strategies, lending markets, and liquid staking products all use on Pharos.

## Why this is different

Most "wallet" or "asset" skills just list balances. This skill **understands the structure** of RealFi products:

- It identifies vaults vs regular contracts
- It reads the underlying asset (USDC, etc.) and translates share balances into asset terms
- It computes the live share price from on-chain state
- It works on the pAlpha High Yield RWA Vault, any future RealFi vault, lending deposit tokens, and yield farms — same skill, same code

By targeting the standard rather than a single protocol, it scales with the Pharos ecosystem.

## How it works

### Tier 1 — RPC-only (always works, no setup)

For any vault address, the skill:
1. Probes for ERC-4626 conformance by calling `asset()`, `totalAssets()`, `convertToAssets()`
2. Reads vault metadata (name, symbol, decimals, total supply)
3. Reads underlying asset metadata (name, symbol, decimals)
4. Computes share price using `convertToAssets(10^decimals)`
5. If a holder address is provided: reads share balance and current asset value

All read-only — zero gas cost.

### Tier 2 — Verified contract details (with API key)

If you set `SOCIALSCAN_API_KEY`, the skill also:
- Fetches the vault's verified ABI from SocialScan
- Surfaces the verified contract name
- Lists any additional public view functions beyond the standard ERC-4626 set (useful for finding protocol-specific functions like `apy()`, `strategy()`, `feeRecipient()`)

Get a free key at https://developer.socialscan.io.

## Installation

```bash
git clone https://github.com/<your-username>/pharos-realfi-skill.git
cd pharos-realfi-skill
npm install
```

Requires Node.js 18+.

## Usage

### Vault state only

```bash
node scripts/check_realfi.js <vaultAddress> [mainnet|testnet]
```

### Vault + holder position

```bash
node scripts/check_realfi.js <vaultAddress> <holderAddress> mainnet
```

### Using a known alias

```bash
node scripts/check_realfi.js pAlpha 0xholder...
```

### With Tier 2 verified details

```bash
export SOCIALSCAN_API_KEY=your_key_here
node scripts/check_realfi.js <vaultAddress> <holderAddress> mainnet
```

## Example output

```
Vault:          pAlpha High Yield RWA Vault
Address:        0xabc...
Network:        Pharos Pacific Ocean Mainnet
Standard:       ERC-4626 ✓
Share token:    pAlpha Vault Share (pAVS)

— Underlying asset —
Asset:          USD Coin (USDC)
Address:        0x1234...
Decimals:       6

— Vault state —
Total assets:   12,453,200.5 USDC
Total shares:   12,103,872.41 pAVS
Share price:    1.0288 USDC per share

— Holder position (0xdef...) —
Shares held:    5,000 pAVS
Current value:  5,144.18 USDC
(P/L requires deposit history — not available on-chain alone)

— Verified contract —
(Set SOCIALSCAN_API_KEY env var to enable verified contract details)

Explorer:       https://pharosscan.xyz/address/0xabc...
```

If the contract doesn't conform to ERC-4626, the skill reports that cleanly and stops without crashing.

## Known vault aliases

The script ships with a small alias table (`KNOWN_VAULTS`) so users can refer to flagship Pharos RealFi products by name (e.g. `pAlpha`). The table is intentionally short — add to it as new vaults are confirmed and verified.

## Using as an Agent Skill

This repo follows the [open Agent Skills format](https://agentskills.io/specification):

```
pharos-realfi-skill/
├── SKILL.md              # Triggers on natural-language vault questions
├── scripts/
│   └── check_realfi.js   # The actual interaction logic
├── package.json
└── README.md
```

Example agent prompts that trigger it:
- "Check my position in the pAlpha vault on Pharos"
- "What's the current TVL of vault 0xabc... on Pharos?"
- "Is 0xdef... an ERC-4626 vault?"
- "Show me the share price and underlying asset of this Pharos vault"

## Why ERC-4626

ERC-4626 is the on-chain standard for tokenized vaults. It's used by:
- RWA vaults (e.g. the pAlpha High Yield RWA Vault)
- Yield farming strategies
- Lending market deposit receipts
- Liquid staking products
- Structured RealFi products

One standard, one skill, every RealFi vault on Pharos.

## Network details

| Network | Chain ID | RPC | Explorer |
|---|---|---|---|
| Mainnet | 1672 | `https://rpc.pharos.xyz` | `https://pharosscan.xyz` |
| Atlantic Testnet | 688689 | `https://atlantic.dplabs-internal.com` | `https://atlantic.pharosscan.xyz` |

## License

MIT
