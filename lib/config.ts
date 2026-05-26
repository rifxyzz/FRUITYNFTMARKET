export const CITREA_CHAIN_ID = 4114;
export const CITREA_CHAIN_HEX = "0x1012";
export const CITREA_RPC_URL = process.env.NEXT_PUBLIC_CITREA_RPC || "https://rpc.mainnet.citrea.xyz";
export const CITREA_EXPLORER = "https://explorer.mainnet.citrea.xyz";

export const NFT_COLLECTIONS = [
  {
    key: "fruity",
    label: "FRUITY NFT",
    shortLabel: "FRUITY",
    address: "0x55F8E43d2719E154E778B18a874BD099F0162bBA",
    explorer: `${CITREA_EXPLORER}/token/0x55F8E43d2719E154E778B18a874BD099F0162bBA`,
  },
  {
    key: "satsumillion",
    label: "SatsuMillion NFT",
    shortLabel: "SATSU",
    address: "0x428B878cB6383216AaDc4e8495037E8d31612621",
    explorer: `${CITREA_EXPLORER}/token/0x428B878cB6383216AaDc4e8495037E8d31612621`,
  },
] as const;

export const MARKETPLACE_ADDRESS = process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS || "";
