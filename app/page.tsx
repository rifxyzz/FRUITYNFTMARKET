"use client";

import { BrowserProvider, Contract, JsonRpcProvider, formatEther, parseEther } from "ethers";
import type { EventLog, Log } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ERC721_ABI, MARKETPLACE_ABI } from "@/lib/abi";
import {
  CITREA_CHAIN_HEX,
  CITREA_CHAIN_ID,
  CITREA_EXPLORER,
  CITREA_RPC_URL,
  MARKETPLACE_ADDRESS,
  NFT_COLLECTIONS,
} from "@/lib/config";
import type { CollectionKey, CollectionState, ListingState, NftItem, NftMetadata } from "@/lib/types";

type TabKey = "inventory" | "create" | "market";

type StatusState = {
  type: "info" | "ok" | "error";
  message: string;
} | null;

const readProvider = new JsonRpcProvider(CITREA_RPC_URL);
const zeroAddress = "0x0000000000000000000000000000000000000000";
const INVENTORY_PROBE_LIMIT = Number(process.env.NEXT_PUBLIC_NFT_PROBE_LIMIT || 250);
const MARKET_PROBE_LIMIT = Number(process.env.NEXT_PUBLIC_MARKET_PROBE_LIMIT || 24);

const formatCbtc = (value: bigint) => `${formatEther(value)} cBTC`;

export default function Home() {
  const [tab, setTab] = useState<TabKey>("inventory");
  const [account, setAccount] = useState("");
  const [status, setStatus] = useState<StatusState>(null);
  const [collections, setCollections] = useState<CollectionState[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<CollectionKey>(NFT_COLLECTIONS[0].key);
  const [inventory, setInventory] = useState<NftItem[]>([]);
  const [marketItems, setMarketItems] = useState<NftItem[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(true);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [minting, setMinting] = useState(false);
  const [listingTokenId, setListingTokenId] = useState("");
  const [listingPrice, setListingPrice] = useState("");
  const [buyTarget, setBuyTarget] = useState("");

  const shortAccount = useMemo(() => (account ? `${account.slice(0, 6)}…${account.slice(-4)}` : ""), [account]);
  const selected = collections.find((collection) => collection.key === selectedCollection);

  const getReadContract = useCallback((address: string) => new Contract(address, ERC721_ABI, readProvider), []);

  const resolveUri = useCallback((uri?: string) => {
    if (!uri) return "";
    if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
    if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice(5)}`;
    if (uri.startsWith("data:")) return uri;
    return uri;
  }, []);

  const fallbackMeta = useCallback((symbol: string, tokenId: string): NftMetadata => ({
    name: `${symbol || "NFT"} #${tokenId}`,
    description: "Metadata is not available or failed to load from tokenURI.",
    image: "",
    attributes: [],
  }), []);

  const loadMetadata = useCallback(async (contract: Contract, symbol: string, tokenId: string, collectionImageUrl?: string) => {
    const meta = fallbackMeta(symbol, tokenId);
    try {
      const tokenUri = resolveUri(await contract.tokenURI(tokenId));
      if (!tokenUri) return { ...meta, image: collectionImageUrl || meta.image };
      const response = await fetch(tokenUri, { cache: "no-store" });
      if (!response.ok) return { ...meta, image: collectionImageUrl || meta.image };
      const json = await response.json();
      return {
        name: json.name || meta.name,
        description: json.description || meta.description,
        image: resolveUri(json.image || json.image_url || json.animation_url || collectionImageUrl || ""),
        attributes: json.attributes || json.traits || [],
      } satisfies NftMetadata;
    } catch {
      return { ...meta, image: collectionImageUrl || meta.image };
    }
  }, [fallbackMeta, resolveUri]);

  const readListing = useCallback(async (collectionAddress: string, tokenId: string): Promise<ListingState | undefined> => {
    if (!MARKETPLACE_ADDRESS) return undefined;
    try {
      const marketplace = new Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, readProvider);
      let seller: string;
      let priceWei: bigint;
      try {
        const result = await marketplace.getListing(collectionAddress, tokenId);
        seller = result.seller;
        priceWei = BigInt(result.price.toString());
      } catch {
        const result = await marketplace.listings(collectionAddress, tokenId);
        seller = result.seller;
        priceWei = BigInt(result.price.toString());
      }
      const active = seller && seller !== zeroAddress && priceWei > 0n;
      if (!active) return undefined;
      return { seller, priceWei, priceLabel: formatCbtc(priceWei), active };
    } catch {
      return undefined;
    }
  }, []);

  const tokenToItem = useCallback(async (
    collection: CollectionState,
    tokenId: string,
    owner?: string,
  ): Promise<NftItem> => {
    const contract = getReadContract(collection.address);
    const metadata = await loadMetadata(contract, collection.symbol, tokenId, collection.imageUrl);
    const listing = await readListing(collection.address, tokenId);
    return {
      tokenId,
      owner,
      collectionKey: collection.key,
      collectionLabel: collection.label,
      collectionAddress: collection.address,
      symbol: collection.symbol,
      metadata,
      listing,
    };
  }, [getReadContract, loadMetadata, readListing]);

  const detectCollections = useCallback(async () => {
    setLoadingCollections(true);
    const detected = await Promise.all(NFT_COLLECTIONS.map(async (item) => {
      const contract = getReadContract(item.address);
      let name = item.label;
      let symbol = item.shortLabel;
      let totalSupply = 0n;
      let mintPrice: bigint | null = null;
      let hasMint = false;

      try { name = await contract.name(); } catch {}
      try { symbol = await contract.symbol(); } catch {}
      try { totalSupply = BigInt((await contract.totalSupply()).toString()); } catch {}
      for (const fn of ["mintPrice", "price", "cost"] as const) {
        if (mintPrice !== null) continue;
        try {
          mintPrice = BigInt((await contract[fn]()).toString());
          hasMint = true;
        } catch {}
      }
      try {
        await contract.supportsInterface("0x80ac58cd");
      } catch {}

      const collectionUrl = "collectionUrl" in item && typeof item.collectionUrl === "string" ? item.collectionUrl : undefined;
      const imageUrl = "imageUrl" in item && typeof item.imageUrl === "string" ? item.imageUrl : undefined;

      return {
        key: item.key,
        label: item.label,
        shortLabel: item.shortLabel,
        address: item.address,
        name,
        symbol,
        totalSupply,
        mintPrice,
        hasMint,
        listedCount: 0,
        floorPriceWei: null,
        floorPriceLabel: "No active listings",
        collectionUrl,
        imageUrl,
      } satisfies CollectionState;
    }));
    setCollections(detected);
    setLoadingCollections(false);
  }, [getReadContract]);

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      setStatus({ type: "error", message: "No wallet detected. Please install MetaMask or another EVM wallet first." });
      return;
    }
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      const browserProvider = new BrowserProvider(window.ethereum);
      const network = await browserProvider.getNetwork();
      if (Number(network.chainId) !== CITREA_CHAIN_ID) {
        setStatus({ type: "info", message: "Switching wallet to Citrea Mainnet…" });
        try {
          await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CITREA_CHAIN_HEX }] });
        } catch (error) {
          const code = typeof error === "object" && error && "code" in error ? (error as { code?: number }).code : undefined;
          if (code === 4902) {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [{
                chainId: CITREA_CHAIN_HEX,
                chainName: "Citrea Mainnet",
                nativeCurrency: { name: "Citrea Bitcoin", symbol: "cBTC", decimals: 18 },
                rpcUrls: [CITREA_RPC_URL],
                blockExplorerUrls: [CITREA_EXPLORER],
              }],
            });
          } else {
            throw error;
          }
        }
      }
      const signer = await browserProvider.getSigner();
      const address = await signer.getAddress();
      setAccount(address);
      setStatus({ type: "ok", message: `Wallet connected: ${address.slice(0, 6)}…${address.slice(-4)}` });
    } catch (error) {
      setStatus({ type: "error", message: `Wallet connection failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }, []);

  const getTokenIdFromTransfer = useCallback((log: EventLog | Log) => {
    if ("args" in log && log.args?.tokenId !== undefined) return log.args.tokenId.toString();
    if (log.topics[3]) return BigInt(log.topics[3]).toString();
    return undefined;
  }, []);

  const loadOwnedTokenIds = useCallback(async (collection: CollectionState, contract: Contract) => {
    const owned = new Set<string>();
    let balance = 0n;
    try { balance = BigInt((await contract.balanceOf(account)).toString()); } catch {}

    for (let i = 0n; i < balance; i++) {
      try { owned.add((await contract.tokenOfOwnerByIndex(account, i)).toString()); } catch { break; }
    }

    if (owned.size < Number(balance)) {
      try {
        const transferFilter = contract.filters.Transfer;
        const receivedLogs = await contract.queryFilter(transferFilter(null, account), 0, "latest");
        const sentLogs = await contract.queryFilter(transferFilter(account, null), 0, "latest");
        const candidates = new Set<string>();
        [...receivedLogs, ...sentLogs].forEach((log) => {
          const tokenId = getTokenIdFromTransfer(log);
          if (tokenId) candidates.add(tokenId);
        });
        for (const tokenId of candidates) {
          try {
            const owner = await contract.ownerOf(tokenId);
            if (owner.toLowerCase() === account.toLowerCase()) owned.add(tokenId);
            else owned.delete(tokenId);
          } catch {}
        }
      } catch {}
    }

    if (owned.size < Number(balance)) {
      const max = collection.totalSupply > BigInt(INVENTORY_PROBE_LIMIT) ? BigInt(INVENTORY_PROBE_LIMIT) : collection.totalSupply;
      for (let probe = 0n; probe <= max && owned.size < Number(balance); probe++) {
        try {
          const owner = await contract.ownerOf(probe);
          if (owner.toLowerCase() === account.toLowerCase()) owned.add(probe.toString());
        } catch {}
      }
    }

    return [...owned];
  }, [account, getTokenIdFromTransfer]);

  const loadInventory = useCallback(async () => {
    if (!account || collections.length === 0) return;
    setLoadingInventory(true);
    setStatus({ type: "info", message: "Syncing SatsuMillion NFT from wallet balance and transfer history…" });
    const found: NftItem[] = [];

    for (const collection of collections) {
      const contract = getReadContract(collection.address);
      const tokenIds = await loadOwnedTokenIds(collection, contract);
      for (const tokenId of tokenIds) found.push(await tokenToItem(collection, tokenId, account));
    }

    setInventory(found);
    setLoadingInventory(false);
    setStatus({ type: "ok", message: `Inventory loaded: ${found.length} NFT detected.` });
  }, [account, collections, getReadContract, loadOwnedTokenIds, tokenToItem]);

  const loadMarket = useCallback(async () => {
    if (collections.length === 0) return;
    setLoadingMarket(true);
    const items: NftItem[] = [];

    for (const collection of collections) {
      const contract = getReadContract(collection.address);
      const limit = collection.totalSupply > BigInt(MARKET_PROBE_LIMIT) ? BigInt(MARKET_PROBE_LIMIT) : collection.totalSupply;
      for (let index = 0n; index < limit; index++) {
        let tokenId = index.toString();
        try { tokenId = (await contract.tokenByIndex(index)).toString(); } catch { tokenId = (index + 1n).toString(); }
        const item = await tokenToItem(collection, tokenId);
        if (item.listing?.active || (!MARKETPLACE_ADDRESS && items.length < MARKET_PROBE_LIMIT)) items.push(item);
      }
    }

    setCollections((current) => {
      let changed = false;
      const next = current.map((collection) => {
        const activeListings = items.filter((item) => item.collectionAddress.toLowerCase() === collection.address.toLowerCase() && item.listing?.active);
        const floorPriceWei = activeListings.reduce<bigint | null>((floor, item) => {
          const price = item.listing?.priceWei;
          if (!price) return floor;
          return floor === null || price < floor ? price : floor;
        }, null);
        const floorPriceLabel = floorPriceWei === null ? "No active listings" : formatCbtc(floorPriceWei);
        if (collection.listedCount !== activeListings.length || collection.floorPriceWei !== floorPriceWei || collection.floorPriceLabel !== floorPriceLabel) changed = true;
        return {
          ...collection,
          listedCount: activeListings.length,
          floorPriceWei,
          floorPriceLabel,
        };
      });
      return changed ? next : current;
    });
    setMarketItems(items);
    setLoadingMarket(false);
  }, [collections, getReadContract, tokenToItem]);

  const mintNft = useCallback(async () => {
    if (!window.ethereum || !selected) return;
    setMinting(true);
    try {
      const browserProvider = new BrowserProvider(window.ethereum);
      const signer = await browserProvider.getSigner();
      const contract = new Contract(selected.address, ERC721_ABI, signer);
      const value = selected.mintPrice ?? 0n;
      let tx;
      try { tx = await contract["mint(uint256)"](1, { value }); }
      catch {
        try { tx = await contract["mint()"]({ value }); }
        catch { tx = await contract.safeMint(await signer.getAddress(), { value }); }
      }
      setStatus({ type: "info", message: `Mint tx submitted: ${tx.hash}` });
      await tx.wait();
      setStatus({ type: "ok", message: `Mint successful: ${tx.hash}` });
      await detectCollections();
      await loadInventory();
    } catch (error) {
      setStatus({ type: "error", message: `Mint failed: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setMinting(false);
    }
  }, [detectCollections, loadInventory, selected]);

  const listNft = useCallback(async () => {
    if (!window.ethereum || !selected || !MARKETPLACE_ADDRESS || !listingTokenId || !listingPrice) return;
    try {
      const browserProvider = new BrowserProvider(window.ethereum);
      const signer = await browserProvider.getSigner();
      const signerAddress = await signer.getAddress();
      const nft = new Contract(selected.address, ERC721_ABI, signer);
      const marketplace = new Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);
      const approved = await nft.isApprovedForAll(signerAddress, MARKETPLACE_ADDRESS);
      if (!approved) {
        const approveTx = await nft.setApprovalForAll(MARKETPLACE_ADDRESS, true);
        setStatus({ type: "info", message: `Approval submitted: ${approveTx.hash}` });
        await approveTx.wait();
      }
      const tx = await marketplace.listItem(selected.address, listingTokenId, parseEther(listingPrice));
      setStatus({ type: "info", message: `Listing submitted: ${tx.hash}` });
      await tx.wait();
      setStatus({ type: "ok", message: `NFT #${listingTokenId} listed for ${listingPrice} cBTC.` });
      await loadInventory();
      await loadMarket();
    } catch (error) {
      setStatus({ type: "error", message: `Listing failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }, [listingPrice, listingTokenId, loadInventory, loadMarket, selected]);

  const buyNft = useCallback(async (item?: NftItem) => {
    if (!window.ethereum || !MARKETPLACE_ADDRESS) return;
    const target = item || marketItems.find((marketItem) => `${marketItem.collectionAddress}:${marketItem.tokenId}` === buyTarget);
    if (!target?.listing?.active) return;
    try {
      const browserProvider = new BrowserProvider(window.ethereum);
      const signer = await browserProvider.getSigner();
      const marketplace = new Contract(MARKETPLACE_ADDRESS, MARKETPLACE_ABI, signer);
      const tx = await marketplace.buyItem(target.collectionAddress, target.tokenId, { value: target.listing.priceWei });
      setStatus({ type: "info", message: `Buy submitted: ${tx.hash}` });
      await tx.wait();
      setStatus({ type: "ok", message: `Purchase successful for ${target.metadata.name}.` });
      await loadInventory();
      await loadMarket();
    } catch (error) {
      setStatus({ type: "error", message: `Purchase failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  }, [buyTarget, loadInventory, loadMarket, marketItems]);

  useEffect(() => { void detectCollections(); }, [detectCollections]);
  useEffect(() => { if (account) void loadInventory(); }, [account, loadInventory]);

  return (
    <main>
      <div className="fruity-bg" />
      <header className="site-header">
        <div className="logo-wrap">
          <div className="logo-mark">🍊</div>
          <div>
            <strong>Satsu<span>Million</span> Mint</strong>
            <small>Citrea Mainnet · Holder detector + mint deck</small>
          </div>
        </div>
        <button className="connect-btn" onClick={connectWallet}>{account ? shortAccount : "Connect Wallet"}</button>
      </header>

      <section className="hero">
        <p className="eyebrow">SatsuMillion · Citrea NFT Mint</p>
        <h1>Mint, scan, and flex your SatsuMillion stack.</h1>
        <p className="hero-copy">A Yuzu-style mint dashboard with wallet connect, contract-aware holder detection, and a cleaner NFT deck for SatsuMillion on Citrea.</p>
        {status && <div className={`status ${status.type}`}>{status.message}</div>}
      </section>

      <section className="stats-grid">
        {loadingCollections ? <article className="panel">Loading collections…</article> : collections.map((collection) => (
          <article className="panel" key={collection.key}>
            <div className="panel-label">{collection.label}</div>
            <h3>{collection.name}</h3>
            <p>{collection.symbol} · {collection.totalSupply.toLocaleString()} supply</p>
            <p>{MARKETPLACE_ADDRESS ? `${collection.listedCount.toLocaleString()} listed · Floor ${collection.floorPriceLabel}` : "Market loads only when opened"}</p>
            <div className="panel-links">
              <a href={`${CITREA_EXPLORER}/token/${collection.address}`} target="_blank">Explorer</a>
              {collection.collectionUrl && <a href={collection.collectionUrl} target="_blank">Collection</a>}
            </div>
          </article>
        ))}
      </section>

      <nav className="tabs">
        {(["inventory", "create", "market"] as TabKey[]).map((key) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {key === "inventory" ? "My NFTs" : key === "create" ? "Mint" : "Market"}
          </button>
        ))}
      </nav>

      {tab === "inventory" && (
        <section className="section-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Wallet Inventory</p>
              <h2>NFT Inventory</h2>
            </div>
            <button className="ghost-btn" onClick={loadInventory} disabled={!account || loadingInventory}>{loadingInventory ? "Scanning…" : "Refresh Inventory"}</button>
          </div>
          {!account ? <Empty text="Connect your wallet first to detect your SatsuMillion NFTs." /> : <NftGrid items={inventory} emptyText="No SatsuMillion NFTs detected in this wallet yet." />}
        </section>
      )}

      {tab === "create" && (
        <section className="section-card split">
          <div>
            <p className="eyebrow">Mint / Create</p>
            <h2>Mint SatsuMillion</h2>
            <p className="muted">Connect wallet, let the app detect the live contract state, then mint through common functions: mint(uint256), mint(), or safeMint(address). If minting is gated, the transaction may revert from the contract.</p>
          </div>
          <div className="form-card">
            <label>Collection</label>
            <select value={selectedCollection} onChange={(event) => setSelectedCollection(event.target.value as CollectionKey)}>
              {collections.map((collection) => <option key={collection.key} value={collection.key}>{collection.label} · {collection.symbol}</option>)}
            </select>
            <div className="price-box">Mint price: {selected?.mintPrice !== null && selected?.mintPrice !== undefined ? `${formatEther(selected.mintPrice)} cBTC` : "unknown / contract-gated"}</div>
            <button className="primary-btn" onClick={mintNft} disabled={!account || !selected || minting}>{minting ? "Minting…" : "Mint NFT"}</button>
          </div>
        </section>
      )}

      {tab === "market" && (
        <section className="section-card">
          <div className="section-head">
            <div>
              <p className="eyebrow">Marketplace</p>
              <h2>Buy & Sell NFT</h2>
            </div>
            <button className="ghost-btn" onClick={loadMarket} disabled={loadingMarket}>{loadingMarket ? "Loading…" : "Refresh Market"}</button>
          </div>

          {!MARKETPLACE_ADDRESS && <div className="status info">Set NEXT_PUBLIC_MARKETPLACE_ADDRESS in .env to enable real list/buy transactions. Without it, the market UI works as a collection preview.</div>}

          <div className="market-actions">
            <div className="form-card">
              <h3>Sell NFT</h3>
              <label>Collection</label>
              <select value={selectedCollection} onChange={(event) => setSelectedCollection(event.target.value as CollectionKey)}>
                {collections.map((collection) => <option key={collection.key} value={collection.key}>{collection.label}</option>)}
              </select>
              <label>Token ID</label>
              <input value={listingTokenId} onChange={(event) => setListingTokenId(event.target.value)} placeholder="example: 1" />
              <label>cBTC Price</label>
              <input value={listingPrice} onChange={(event) => setListingPrice(event.target.value)} placeholder="example: 0.01" />
              <div className="price-box">Listing price: {listingPrice ? `${listingPrice} cBTC` : "enter a cBTC amount"}</div>
              <button className="primary-btn" onClick={listNft} disabled={!account || !MARKETPLACE_ADDRESS || !listingTokenId || !listingPrice}>List NFT</button>
            </div>
            <div className="form-card">
              <h3>Buy NFT</h3>
              <label>Listing</label>
              <select value={buyTarget} onChange={(event) => setBuyTarget(event.target.value)}>
                <option value="">Choose a listing</option>
                {marketItems.filter((item) => item.listing?.active).map((item) => <option key={`${item.collectionAddress}:${item.tokenId}`} value={`${item.collectionAddress}:${item.tokenId}`}>{item.metadata.name} · {item.listing?.priceLabel}</option>)}
              </select>
              <button className="primary-btn" onClick={() => void buyNft()} disabled={!account || !MARKETPLACE_ADDRESS || !buyTarget}>Buy NFT</button>
            </div>
          </div>

          <NftGrid items={marketItems} emptyText="No active listings found yet." onBuy={MARKETPLACE_ADDRESS ? buyNft : undefined} />
        </section>
      )}
    </main>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty"><span>🖼️</span><p>{text}</p></div>;
}

function NftGrid({ items, emptyText, onBuy }: { items: NftItem[]; emptyText: string; onBuy?: (item: NftItem) => void }) {
  if (!items.length) return <Empty text={emptyText} />;
  return (
    <div className="nft-grid">
      {items.map((item) => (
        <article className="nft-card" key={`${item.collectionAddress}:${item.tokenId}`}>
          <div className="nft-image">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {item.metadata.image ? <img src={item.metadata.image} alt={item.metadata.name} referrerPolicy="no-referrer" /> : <span>🍊</span>}
          </div>
          <div className="nft-body">
            <div className="pill">{item.collectionLabel}</div>
            <h3>{item.metadata.name}</h3>
            <p>#{item.tokenId} · {item.symbol}</p>
            {item.listing?.active && <strong className="price">Listed: {item.listing.priceLabel}</strong>}
            <div className="card-actions">
              <a href={`${CITREA_EXPLORER}/token/${item.collectionAddress}/instance/${item.tokenId}`} target="_blank">Explorer</a>
              {onBuy && item.listing?.active && <button onClick={() => onBuy(item)}>Buy</button>}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
