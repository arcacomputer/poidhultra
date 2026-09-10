import { createConfig } from "ponder";
import {
  abi,
  legacyAbi,
  nftAbi,
  deployments,
  legacyDeployments,
} from "@poidh/protocol";
const [eth, base, arb] = deployments;
export default createConfig({
  ordering: "multichain",
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.MAINNET_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
    },
    base: {
      id: 8453,
      rpc: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
    },
    arbitrum: {
      id: 42161,
      rpc: process.env.ARBITRUM_RPC_URL ?? "https://arb1.arbitrum.io/rpc",
    },
  },
  contracts: {
    Poidh: {
      abi,
      chain: {
        mainnet: { address: eth.address, startBlock: eth.startBlock },
        base: { address: base.address, startBlock: base.startBlock },
        arbitrum: { address: arb.address, startBlock: arb.startBlock },
      },
    },
    NFT: {
      abi: nftAbi,
      chain: {
        mainnet: { address: eth.nft, startBlock: eth.startBlock - 1 },
        base: { address: base.nft, startBlock: base.startBlock },
        arbitrum: { address: arb.nft, startBlock: arb.startBlock - 12 },
      },
    },
    Legacy: {
      abi: legacyAbi,
      chain: {
        base: {
          address: legacyDeployments[0].address,
          startBlock: legacyDeployments[0].startBlock,
          endBlock: legacyDeployments[0].endBlock,
        },
        arbitrum: {
          address: legacyDeployments[1].address,
          startBlock: legacyDeployments[1].startBlock,
          endBlock: legacyDeployments[1].endBlock,
        },
      },
    },
    LegacyNFT: {
      abi: nftAbi,
      chain: {
        base: {
          address: "0xDdfb1A53E7b73Dba09f79FCA24765C593D447a80",
          startBlock: 14542570,
          endBlock: 39565960,
        },
        arbitrum: {
          address: "0xDdfb1A53E7b73Dba09f79FCA24765C593D447a80",
          startBlock: 211898311,
          endBlock: 406284950,
        },
      },
    },
  },
});
