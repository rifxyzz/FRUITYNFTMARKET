// scripts/indexer.ts
import { JsonRpcProvider, Contract } from "ethers";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";
const prisma = new PrismaClient();

const RPC_URL = process.env.NEXT_PUBLIC_CITREA_RPC || "https://rpc.mainnet.citrea.xyz";
const CONTRACT_ADDRESS = "0x42bc7f08a01ab9ebcb93b4e4af277b2c7fa877af"; // Satsumillions
const CHUNK_SIZE = 999;
const POLL_INTERVAL = 15_000; // 15 seconds

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const ERC721_ABI = [
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function totalSupply() view returns (uint256)",
];

const provider = new JsonRpcProvider(RPC_URL);
const contract = new Contract(CONTRACT_ADDRESS, ERC721_ABI, provider);

function resolveUri(uri: string): string {
  if (!uri) return "";
  if (uri.startsWith("ipfs://")) return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}

async function fetchMetadata(tokenId: string) {
  try {
    const uri = resolveUri(await contract.tokenURI(tokenId));
    if (!uri) return null;
    const res = await fetch(uri, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    return {
      metadataUri: uri,
      name: json.name || `NFT #${tokenId}`,
      description: json.description || "",
      image: resolveUri(json.image || json.image_url || ""),
      attributes: json.attributes || json.traits || [],
    };
  } catch {
    return null;
  }
}

async function processTransferLog(log: {
  topics: string[];
  blockNumber: number;
  transactionHash: string;
}) {
  const fromAddress = "0x" + log.topics[1].slice(26);
  const toAddress = "0x" + log.topics[2].slice(26);
  const tokenId = BigInt(log.topics[3]).toString();

  console.log(`Transfer: #${tokenId} ${fromAddress.slice(0,6)}… → ${toAddress.slice(0,6)}… (block ${log.blockNumber})`);

  // Upsert token ownership
  const existing = await prisma.token.findUnique({
    where: { tokenId_contractAddress: { tokenId, contractAddress: CONTRACT_ADDRESS } },
  });

  if (!existing) {
    // New token — fetch metadata
    const meta = await fetchMetadata(tokenId);
    await prisma.token.create({
      data: {
        tokenId,
        contractAddress: CONTRACT_ADDRESS,
        owner: toAddress.toLowerCase(),
        metadataUri: meta?.metadataUri,
        name: meta?.name,
        description: meta?.description,
        image: meta?.image,
        attributes: meta?.attributes,
      },
    });
  } else {
    // Update owner
    await prisma.token.update({
      where: { tokenId_contractAddress: { tokenId, contractAddress: CONTRACT_ADDRESS } },
      data: { owner: toAddress.toLowerCase() },
    });

    // If transferred, deactivate listing
    if (fromAddress !== "0x0000000000000000000000000000000000000000") {
      await prisma.listing.updateMany({
        where: { tokenId, contractAddress: CONTRACT_ADDRESS, active: true },
        data: { active: false },
      });
    }
  }

  // Record transfer
  await prisma.transfer.create({
    data: {
      tokenId,
      contractAddress: CONTRACT_ADDRESS,
      fromAddress: fromAddress.toLowerCase(),
      toAddress: toAddress.toLowerCase(),
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
    },
  });
}

async function indexRange(fromBlock: number, toBlock: number) {
  const logs = await provider.getLogs({
    address: CONTRACT_ADDRESS,
    topics: [TRANSFER_TOPIC],
    fromBlock,
    toBlock,
  });

  for (const log of logs) {
    await processTransferLog({
      topics: log.topics as string[],
      blockNumber: log.blockNumber,
      transactionHash: log.transactionHash,
    });
  }

  return logs.length;
}

async function calculateRarity() {
  console.log("Calculating rarity scores...");
  const tokens = await prisma.token.findMany({
    where: { contractAddress: CONTRACT_ADDRESS, attributes: { not: null } },
  });

  if (tokens.length === 0) return;

  // Count trait frequencies
  const traitCounts: Record<string, Record<string, number>> = {};
  for (const token of tokens) {
    const attrs = token.attributes as { trait_type: string; value: string }[];
    if (!Array.isArray(attrs)) continue;
    for (const attr of attrs) {
      if (!traitCounts[attr.trait_type]) traitCounts[attr.trait_type] = {};
      traitCounts[attr.trait_type][attr.value] = (traitCounts[attr.trait_type][attr.value] || 0) + 1;
    }
  }

  // Calculate rarity score per token
  const scored = tokens.map((token) => {
    const attrs = token.attributes as { trait_type: string; value: string }[];
    if (!Array.isArray(attrs)) return { id: token.id, score: 0 };
    let score = 0;
    for (const attr of attrs) {
      const count = traitCounts[attr.trait_type]?.[attr.value] || 1;
      score += tokens.length / count;
    }
    return { id: token.id, score };
  });

  // Sort and assign ranks
  scored.sort((a, b) => b.score - a.score);
  for (let i = 0; i < scored.length; i++) {
    await prisma.token.update({
      where: { id: scored[i].id },
      data: { rarityScore: scored[i].score, rarityRank: i + 1 },
    });
  }

  console.log(`Rarity calculated for ${scored.length} tokens.`);
}

async function run() {
  console.log("🍊 Fruity NFT Indexer starting...");

  // Get or create indexer state
  let state = await prisma.indexerState.findUnique({
    where: { contractAddress: CONTRACT_ADDRESS },
  });

  if (!state) {
    state = await prisma.indexerState.create({
      data: { contractAddress: CONTRACT_ADDRESS, lastIndexedBlock: 0 },
    });
  }

  let rarityLastCalculated = 0;

  while (true) {
    try {
      const currentBlock = await provider.getBlockNumber();
      let fromBlock = state.lastIndexedBlock + 1;

      if (fromBlock > currentBlock) {
        console.log(`Up to date at block ${currentBlock}. Polling...`);
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        continue;
      }

      let totalProcessed = 0;
      while (fromBlock <= currentBlock) {
        const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, currentBlock);
        console.log(`Indexing blocks ${fromBlock} → ${toBlock}...`);
        const count = await indexRange(fromBlock, toBlock);
        totalProcessed += count;
        fromBlock = toBlock + 1;

        // Update state
        state = await prisma.indexerState.update({
          where: { contractAddress: CONTRACT_ADDRESS },
          data: { lastIndexedBlock: toBlock },
        });
      }

      if (totalProcessed > 0) {
        console.log(`Indexed ${totalProcessed} transfers.`);
      }

      // Recalculate rarity every 1000 blocks
      if (currentBlock - rarityLastCalculated > 1000) {
        await calculateRarity();
        rarityLastCalculated = currentBlock;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    } catch (err) {
      console.error("Indexer error:", err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

run().catch(console.error);
