// app/api/stats/route.ts
import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CONTRACT_ADDRESS = "0x42bc7f08a01ab9ebcb93b4e4af277b2c7fa877af";

export async function GET() {
  const [totalTokens, totalOwners, activeListings, state] = await Promise.all([
    prisma.token.count({ where: { contractAddress: CONTRACT_ADDRESS } }),
    prisma.token.groupBy({
      by: ["owner"],
      where: { contractAddress: CONTRACT_ADDRESS },
    }),
    prisma.listing.findMany({
      where: { contractAddress: CONTRACT_ADDRESS, active: true },
      orderBy: { priceWei: "asc" },
    }),
    prisma.indexerState.findUnique({
      where: { contractAddress: CONTRACT_ADDRESS },
    }),
  ]);

  const floorListing = activeListings[0];
  const floorPriceWei = floorListing?.priceWei || null;

  return NextResponse.json({
    totalTokens,
    totalOwners: totalOwners.length,
    listedCount: activeListings.length,
    floorPriceWei,
    lastIndexedBlock: state?.lastIndexedBlock || 0,
  });
}
