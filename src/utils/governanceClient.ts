import { createPublicClient, http, parseAbiItem } from 'viem'
import { gnosis } from 'viem/chains'
import { GOVERNANCE_CONTRACTS } from '@/constants/governance'

const GOVERNOR_ABI = [
  parseAbiItem(
    'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)'
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
