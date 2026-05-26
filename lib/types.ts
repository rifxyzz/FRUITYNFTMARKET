import { NFT_COLLECTIONS } from "./config";

export type CollectionKey = (typeof NFT_COLLECTIONS)[number]["key"];

export type NftAttribute = {
  trait_type?: string;
  value?: string | number;
};

export type NftMetadata = {
  name: string;
  description: string;
  image: string;
  attributes: NftAttribute[];
};

export type NftItem = {
  tokenId: string;
  owner?: string;
  collectionKey: CollectionKey;
  collectionLabel: string;
  collectionAddress: string;
  symbol: string;
  metadata: NftMetadata;
  listing?: ListingState;
};

export type ListingState = {
  seller: string;
  priceWei: bigint;
  priceLabel: string;
  active: boolean;
};

export type CollectionState = {
  key: CollectionKey;
  label: string;
  shortLabel: string;
  address: string;
  name: string;
  symbol: string;
  totalSupply: bigint;
  mintPrice: bigint | null;
  hasMint: boolean;
};

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}
