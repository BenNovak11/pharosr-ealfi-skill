#!/usr/bin/env node
/**
 * Pharos RealFi Product Interaction Skill
 *
 * Reads any ERC-4626 vault on the Pharos Network and (optionally) a holder's
 * position in it. Built for the Pharos Agent Center Skill Builder Campaign.
 *
 * Tier 1 (always): RPC-only — vault state, share price, asset metadata, holder position
 * Tier 2 (optional): SocialScan ABI fetch for verified contract name and extra view functions
 *
 * Usage:
 *   node scripts/check_realfi.js <vault> [holder] [mainnet|testnet]
 *   SOCIALSCAN_API_KEY=<key> node scripts/check_realfi.js <vault> <holder> mainnet
 */

import {
  createPublicClient,
  http,
  defineChain,
  isAddress,
  getAddress,
  parseAbi,
  formatUnits,
} from "viem";

// --- URL constants (grouped for easy paste-audit) ---
const RPC_MAINNET = "https://rpc.pharos.xyz";
const RPC_TESTNET = "https://atlantic.dplabs-internal.com";
const EXPLORER_MAINNET = "https://pharosscan.xyz";
const EXPLORER_TESTNET = "https://atlantic.pharosscan.xyz";
const SOCIALSCAN_BASE = "https://api.socialscan.io";

// --- Pharos chain definitions ---
const pharosMainnet = defineChain({
  id: 1672,
  name: "Pharos Pacific Ocean Mainnet",
  nativeCurrency: { name: "Pharos", symbol: "PROS", decimals: 18 },
  rpcUrls: { default: { http: [RPC_MAINNET] } },
});

const pharosTestnet = defineChain({
  id: 688689,
  name: "Pharos Atlantic Testnet",
  nativeCurrency: { name: "Pharos", symbol: "PROS", decimals: 18 },
  rpcUrls: { default: { http: [RPC_TESTNET] } },
});

const SOCIALSCAN_NETWORKS = {
  mainnet: "pharos-mainnet",
  testnet: "pharos-atlantic-testnet",
};

// --- Known Pharos RealFi vault aliases (case-insensitive) ---
// Extend this map as new vaults are confirmed. Resolution: alias -> { address, displayName }
const KNOWN_VAULTS = {
  // pAlpha High Yield RWA Vault — Pharos's flagship RWA product.
  // Address left as null until verified from Pharos docs; users can still pass the address directly.
  palpha: { address: null, displayName: "pAlpha High Yield RWA Vault" },
};

// --- ABIs ---
const erc4626Abi = parseAbi([
  "function asset() view returns (address)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function convertToShares(uint256 assets) view returns (uint256)",
]);

const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

// --- Safe contract read: returns null on revert ---
async function safeRead(client, address, abi, functionName, args = []) {
  try {
    return await client.readContract({ address, abi, functionName, args });
  } catch {
    return null;
  }
}

// --- Tier 2: fetch verified ABI from SocialScan ---
async function fetchAbi(address, networkKey, apiKey) {
  const network = SOCIALSCAN_NETWORKS[networkKey];
  const url =
    `${SOCIALSCAN_BASE}/${network}/v1/explorer/command_api/contract` +
    `?module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    const r = data?.result?.[0];
    if (!r?.ABI || r.ABI === "Contract source code not verified") return null;
    let parsedAbi = null;
    try {
      parsedAbi = JSON.parse(r.ABI);
    } catch {
      /* ignore */
    }
    return {
      abi: parsedAbi,
      contractName: r.ContractName || null,
    };
  } catch {
    return null;
  }
}

// --- Resolve a user input (address or alias) into an address + optional display name ---
function resolveVault(input) {
  if (!input) throw new Error("Missing vault address or alias.");
  const lower = input.toLowerCase();
  if (KNOWN_VAULTS[lower]) {
    const entry = KNOWN_VAULTS[lower];
    if (!entry.address) {
      throw new Error(
        `Alias "${input}" is recognized as "${entry.displayName}" but its address ` +
          `is not configured in KNOWN_VAULTS. Please pass the address directly.`,
      );
    }
    return { address: getAddress(entry.address), displayName: entry.displayName };
  }
  if (!isAddress(input)) {
    throw new Error(`Not a valid address or known alias: ${input}`);
  }
  return { address: getAddress(input), displayName: null };
}

// --- Main inspection ---
async function checkVault(vaultInput, holderInput, networkKey = "mainnet") {
  const { address: vault, displayName } = resolveVault(vaultInput);

  const holder = holderInput ? (isAddress(holderInput) ? getAddress(holderInput) : null) : null;
  if (holderInput && !holder) {
    throw new Error(`Invalid holder address: ${holderInput}`);
  }

  const chain = networkKey === "testnet" ? pharosTestnet : pharosMainnet;
  const explorerUrl = networkKey === "testnet" ? EXPLORER_TESTNET : EXPLORER_MAINNET;
  const client = createPublicClient({ chain, transport: http() });

  // --- Detect ERC-4626 by probing the key view functions ---
  const assetAddress = await safeRead(client, vault, erc4626Abi, "asset");
  if (!assetAddress) {
    return {
      vault,
      displayName,
      networkName: chain.name,
      isErc4626: false,
      explorer: `${explorerUrl}/address/${vault}`,
    };
  }
  const totalAssets = await safeRead(client, vault, erc4626Abi, "totalAssets");
  if (totalAssets === null) {
    return {
      vault,
      displayName,
      networkName: chain.name,
      isErc4626: false,
      explorer: `${explorerUrl}/address/${vault}`,
    };
  }

  // --- Vault metadata ---
  const [vaultName, vaultSymbol, shareDecimalsRaw, totalSupply] = await Promise.all([
    safeRead(client, vault, erc4626Abi, "name"),
    safeRead(client, vault, erc4626Abi, "symbol"),
    safeRead(client, vault, erc4626Abi, "decimals"),
    safeRead(client, vault, erc4626Abi, "totalSupply"),
  ]);
  const shareDecimals = shareDecimalsRaw ?? 18;

  // --- Underlying asset metadata ---
  const [assetName, assetSymbol, assetDecimalsRaw] = await Promise.all([
    safeRead(client, assetAddress, erc20Abi, "name"),
    safeRead(client, assetAddress, erc20Abi, "symbol"),
    safeRead(client, assetAddress, erc20Abi, "decimals"),
  ]);
  const assetDecimals = assetDecimalsRaw ?? 18;

  // --- Share price: assets per 1 share (in asset units) ---
  let sharePrice = null;
  if (totalSupply && totalSupply > 0n) {
    const oneShare = 10n ** BigInt(shareDecimals);
    sharePrice = await safeRead(client, vault, erc4626Abi, "convertToAssets", [oneShare]);
  }

  // --- Holder position ---
  let holderPosition = null;
  if (holder) {
    const shares = await safeRead(client, vault, erc4626Abi, "balanceOf", [holder]);
    if (shares !== null) {
      const currentValue =
        shares > 0n
          ? await safeRead(client, vault, erc4626Abi, "convertToAssets", [shares])
          : 0n;
      holderPosition = { holder, shares, currentValue };
    }
  }

  // --- Tier 2: fetch verified ABI (only the metadata is shown here, not the whole ABI dump) ---
  const apiKey = process.env.SOCIALSCAN_API_KEY;
  let verified = null;
  if (apiKey) {
    const abiResult = await fetchAbi(vault, networkKey, apiKey);
    if (abiResult) {
      // Surface up to 8 interesting extra view functions (no args, view, not the standard 4626 ones)
      const standardNames = new Set([
        "asset",
        "totalAssets",
        "totalSupply",
        "decimals",
        "name",
        "symbol",
        "balanceOf",
        "convertToAssets",
        "convertToShares",
        "previewDeposit",
        "previewMint",
        "previewWithdraw",
        "previewRedeem",
        "maxDeposit",
        "maxMint",
        "maxWithdraw",
        "maxRedeem",
        "allowance",
        "owner",
      ]);
      const extras = (abiResult.abi || [])
        .filter(
          (item) =>
            item.type === "function" &&
            item.stateMutability === "view" &&
            (item.inputs?.length || 0) === 0 &&
            !standardNames.has(item.name),
        )
        .slice(0, 8)
        .map((item) => item.name);

      verified = {
        contractName: abiResult.contractName,
        extraViewFunctions: extras,
      };
    }
  }

  return {
    vault,
    displayName,
    networkName: chain.name,
    isErc4626: true,
    vaultMetadata: { name: vaultName, symbol: vaultSymbol, decimals: shareDecimals, totalSupply },
    assetAddress,
    assetMetadata: { name: assetName, symbol: assetSymbol, decimals: assetDecimals },
    totalAssets,
    sharePrice,
    holderPosition,
    verified,
    explorer: `${explorerUrl}/address/${vault}`,
  };
}

// --- Output formatter ---
function fmt(amount, decimals) {
  if (amount === null || amount === undefined) return "(unknown)";
  return Number(formatUnits(amount, decimals)).toLocaleString(undefined, {
    maximumFractionDigits: 4,
  });
}

function formatReport(r) {
  const lines = [];
  // --- Header ---
  const header = r.displayName || r.vaultMetadata?.name || "Vault";
  lines.push(`Vault:          ${header}`);
  lines.push(`Address:        ${r.vault}`);
  lines.push(`Network:        ${r.networkName}`);
  if (!r.isErc4626) {
    lines.push(`Standard:       Not ERC-4626 (this contract is not a tokenized vault)`);
    lines.push("");
    lines.push(`Explorer:       ${r.explorer}`);
    return lines.join("\n");
  }
  lines.push(`Standard:       ERC-4626 ✓`);
  if (r.vaultMetadata.symbol) {
    lines.push(`Share token:    ${r.vaultMetadata.name || "?"} (${r.vaultMetadata.symbol})`);
  }

  // --- Underlying asset ---
  lines.push("");
  lines.push("— Underlying asset —");
  const assetLabel = r.assetMetadata.symbol
    ? `${r.assetMetadata.name || "?"} (${r.assetMetadata.symbol})`
    : "(metadata unavailable)";
  lines.push(`Asset:          ${assetLabel}`);
  lines.push(`Address:        ${r.assetAddress}`);
  lines.push(`Decimals:       ${r.assetMetadata.decimals}`);

  // --- Vault state ---
  lines.push("");
  lines.push("— Vault state —");
  lines.push(
    `Total assets:   ${fmt(r.totalAssets, r.assetMetadata.decimals)} ${r.assetMetadata.symbol || ""}`.trim(),
  );
  if (r.vaultMetadata.totalSupply !== null && r.vaultMetadata.totalSupply !== undefined) {
    lines.push(
      `Total shares:   ${fmt(r.vaultMetadata.totalSupply, r.vaultMetadata.decimals)} ${r.vaultMetadata.symbol || ""}`.trim(),
    );
  }
  if (r.sharePrice !== null) {
    lines.push(
      `Share price:    ${fmt(r.sharePrice, r.assetMetadata.decimals)} ${r.assetMetadata.symbol || ""} per share`.trim(),
    );
  } else {
    lines.push(`Share price:    (vault has zero supply)`);
  }

  // --- Holder position ---
  if (r.holderPosition) {
    lines.push("");
    lines.push(`— Holder position (${r.holderPosition.holder}) —`);
    lines.push(
      `Shares held:    ${fmt(r.holderPosition.shares, r.vaultMetadata.decimals)} ${r.vaultMetadata.symbol || ""}`.trim(),
    );
    lines.push(
      `Current value:  ${fmt(r.holderPosition.currentValue, r.assetMetadata.decimals)} ${r.assetMetadata.symbol || ""}`.trim(),
    );
    lines.push(`(P/L requires deposit history — not available on-chain alone)`);
  }

  // --- Verified contract details (Tier 2) ---
  lines.push("");
  if (r.verified) {
    lines.push(`— Verified contract (SocialScan) —`);
    if (r.verified.contractName) lines.push(`Contract name:  ${r.verified.contractName}`);
    if (r.verified.extraViewFunctions.length > 0) {
      lines.push(`Extra views:    ${r.verified.extraViewFunctions.join(", ")}`);
    }
  } else {
    lines.push(`— Verified contract —`);
    lines.push(`(Set SOCIALSCAN_API_KEY env var to enable verified contract details)`);
  }

  lines.push("");
  lines.push(`Explorer:       ${r.explorer}`);

  return lines.join("\n");
}

// --- Argument parsing: support [vault] [holder?] [network?] in flexible order ---
function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0) return null;

  const vault = args[0];
  let holder = null;
  let network = "mainnet";

  for (const a of args.slice(1)) {
    if (a === "mainnet" || a === "testnet") {
      network = a;
    } else if (a.startsWith("0x")) {
      holder = a;
    }
  }
  return { vault, holder, network };
}

// --- CLI entry point ---
async function main() {
  const parsed = parseArgs(process.argv);
  if (!parsed) {
    console.error("Usage: node scripts/check_realfi.js <vault> [holder] [mainnet|testnet]");
    console.error("Optional: set SOCIALSCAN_API_KEY env var for verified contract details");
    process.exit(1);
  }
  try {
    const result = await checkVault(parsed.vault, parsed.holder, parsed.network);
    console.log(formatReport(result));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();

export { checkVault, formatReport };
