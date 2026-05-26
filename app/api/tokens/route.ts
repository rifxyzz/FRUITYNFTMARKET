// app/api/tokens/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CONTRACT_ADDRESS = "0x42bc7f08a01ab9ebcb93b4e4af277b2c7fa877af";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner")?.toLowerCase();
  const listed = searchParams.get("listed");
  const trait_type = searchParams.get("trait_type");
  const trait_value = searchParams.get("trait_value");
  const sort = searchParams.get("sort") || "rarity";
  const page = Number(searchParams.get("page") || 1);
  const limit = Math.min(Number(searchParams.get("limit") || 20), 100);
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { contractAddress: CONTRACT_ADDRESS };

  if (owner) where.owner = owner;

  if (listed === "true") {
    where.listing = { active: true };
  }

  if (trait_type && trait_value) {
    where.attributes = {
      path: "$[*]",
      array_contains: [{ trait_type, value: trait_value }],
    };
  }

  const orderBy =
    sort === "rarity"
      ? { rarityRank: "asc" as const }
      : sort === "price_asc"
      ? { listing: { priceWei: "asc" as const } }
      : { tokenId: "asc" as const };

  const [tokens, total] = await Promise.all([
    prisma.token.findMany({
      where,
      include: { listing: { where: { active: true } } },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.token.count({ where }),
  ]);

  return NextResponse.json({ tokens, total, page, limit });
}
