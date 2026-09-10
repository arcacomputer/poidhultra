// Explicit columns keep the API independent from Ponder's internal and reorg tables.
const bountyColumns =
  "id,chain_id,contract,on_chain_id,display_id,issuer,title,description,amount,created_at,status,multiplayer,claim_count,archive,archive_as_of";
const claimColumns =
  "id,bounty_id,on_chain_id,issuer,owner,title,description,uri,accepted,created_at";
export const bounties = `(SELECT ${bountyColumns} FROM protocol_api.bounty UNION ALL SELECT ${bountyColumns} FROM archive.bounty) AS bounty`;
export const claims = `(SELECT ${claimColumns} FROM protocol_api.claim UNION ALL SELECT ${claimColumns} FROM archive.claim) AS claim`;
export const visibleBounty =
  "NOT EXISTS (SELECT 1 FROM community.protocol_moderation m WHERE m.id=bounty.id AND m.kind='bounty' AND m.hidden)";
export const visibleClaim =
  "NOT EXISTS (SELECT 1 FROM community.protocol_moderation m WHERE m.id=claim.id AND m.kind='claim' AND m.hidden) AND NOT EXISTS (SELECT 1 FROM community.protocol_moderation m WHERE m.id=claim.bounty_id AND m.kind='bounty' AND m.hidden)";
