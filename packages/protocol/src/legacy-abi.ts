// Event declarations transcribed from the SPDX-MIT PoidhV2.sol import.
import { parseAbi } from "viem";
export const legacyAbi = parseAbi([
  "event BountyCreated(uint256 id,address issuer,string name,string description,uint256 amount,uint256 createdAt)",
  "event ClaimCreated(uint256 id,address issuer,uint256 bountyId,address bountyIssuer,string name,string description,uint256 createdAt)",
  "event ClaimAccepted(uint256 bountyId,uint256 claimId,address claimIssuer,address bountyIssuer,uint256 fee)",
  "event BountyJoined(uint256 bountyId,address participant,uint256 amount)",
  "event ClaimSubmittedForVote(uint256 bountyId,uint256 claimId)",
  "event BountyCancelled(uint256 bountyId,address issuer)",
  "event ResetVotingPeriod(uint256 bountyId)",
  "event VoteClaim(address voter,uint256 bountyId,uint256 claimId)",
  "event WithdrawFromOpenBounty(uint256 bountyId,address participant,uint256 amount)",
]);
export const nftAbi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "function tokenURI(uint256) view returns (string)",
  "function ownerOf(uint256) view returns (address)",
]);
