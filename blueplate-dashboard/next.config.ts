import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.BLUEPLATE_EC2_EXPORT === "1" && { output: "export", typescript: { tsconfigPath: "tsconfig.ec2.json" } }),
};

export default nextConfig;
