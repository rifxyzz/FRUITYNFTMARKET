import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: "postgresql://root:1tr7aQOBCski2NzX34KAU5T8f6Dwo0u9@101.33.81.137:31315/zeabur",
  },
});