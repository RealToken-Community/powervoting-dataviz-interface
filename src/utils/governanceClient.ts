import { createPublicClient, http, parseAbiItem } from 'viem'
import { gnosis } from 'viem/chains'
import { GOVERNANCE_CONTRACTS } from '@/constants/governance'

const GOVERNOR_ABI = [
  parseAbiItem(
    'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)'
  ),
  parseAbiItem(
    'event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)'
  ),
] as const

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http('https://rpc.gnosischain.com'),
})

export interface ProposalSummary {
  proposalId: string
  proposer: string
  description: string
  voteStart: bigint
  voteEnd: bigint
}

export async function fetchProposalsFromGovernor(): Promise<ProposalSummary[]> {
  const logs = await publicClient.getContractEvents({
    address: GOVERNANCE_CONTRACTS.Governor as `0x${string}`,
    abi: GOVERNOR_ABI,
    eventName: 'ProposalCreated',
    fromBlock: 0n,
  })

  const proposals: ProposalSummary[] = logs.map((log) => {
    const args = log.args as {
      proposalId: bigint
      proposer: string
      description: string
      voteStart: bigint
      voteEnd: bigint
    }
    return {
      proposalId: String(args.proposalId),
      proposer: args.proposer ?? '',
      description: args.description ?? '',
      voteStart: args.voteStart ?? 0n,
      voteEnd: args.voteEnd ?? 0n,
    }
  })

  proposals.sort((a, b) => Number(b.voteEnd - a.voteEnd))
  return proposals
}

/**
 * Compte le nombre de wallets distincts ayant voté pour chaque proposition.
 * Retourne une Map proposalId -> nombre de votants.
 */
export async function fetchVoterCountByProposal(): Promise<Map<string, number>> {
  const logs = await publicClient.getContractEvents({
    address: GOVERNANCE_CONTRACTS.Governor as `0x${string}`,
    abi: GOVERNOR_ABI,
    eventName: 'VoteCast',
    fromBlock: 0n,
  })

  const countByProposal = new Map<string, Set<string>>()
  for (const log of logs) {
    const args = log.args as { voter: string; proposalId: bigint }
    const proposalId = String(args.proposalId)
    if (!countByProposal.has(proposalId)) {
      countByProposal.set(proposalId, new Set())
    }
    countByProposal.get(proposalId)!.add((args.voter ?? '').toLowerCase())
  }

  const result = new Map<string, number>()
  countByProposal.forEach((voters, proposalId) => {
    result.set(proposalId, voters.size)
  })
  return result
}
