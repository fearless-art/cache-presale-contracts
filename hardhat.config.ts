import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: "0.8.28",
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  networks: {
    eth: {
      url: `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      chainId: 1,
      accounts: [`${process.env.DEPLOYER_PRIVATE_KEY}`],
    },
    sepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      chainId: 11155111,
      accounts: [`${process.env.DEPLOYER_PRIVATE_KEY}`],
    },
    base: {
      url: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      chainId: 84532,
      accounts: [`${process.env.DEPLOYER_PRIVATE_KEY}`],
    },
    base_sepolia: {
      url: `https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      chainId: 84532,
      accounts: [`${process.env.DEPLOYER_PRIVATE_KEY}`],
    },
    bsc: {
      url: "https://bsc-dataseed.bnbchain.org/",
      chainId: 56,
      accounts: [`${process.env.DEPLOYER_PRIVATE_KEY}`],
      gas: 2100000,
      gasPrice: 2000000000, // 2 Gwei
    },
    hardhat: {
      //url: "http://localhost:8545",
      chainId: 1337, //31337
      allowBlocksWithSameTimestamp: true,
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_ETH,
  },
};

// Load the custom tsconfig file
process.env.TS_NODE_PROJECT = "tsconfig.hh.json";

export default config;
