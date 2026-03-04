import { createPublicClient, http, parseAbiItem } from 'viem'
import { gnosis } from 'viem/chains'
import { GOVERNANCE_CONTRACTS } from '@/constants/governance'

const GOVERNOR_ABI = [
  parseAbiItem(
    'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)'
  ),
  parseAbiItem('event ProposalCanceled(uint256 proposalId)'),
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
 * Retourne l'ensemble des proposalId ayant émis ProposalCanceled (votes annulés).
 */
export async function fetchCanceledProposalIds(): Promise<Set<string>> {
  const logs = await publicClient.getContractEvents({
    address: GOVERNANCE_CONTRACTS.Governor as `0x${string}`,
    abi: GOVERNOR_ABI,
    eventName: 'ProposalCanceled',
    fromBlock: 0n,
  })
  const ids = new Set<string>()
  for (const log of logs) {
    const args = log.args as { proposalId: bigint }
    ids.add(String(args.proposalId))
  }
  return ids
}

/** OpenZeppelin Governor: 0 = Against, 1 = For, 2 = Abstain */
export type VoteSupport = 'against' | 'for' | 'abstain'

export interface VoteBreakdown {
  byPower: { for: bigint; against: bigint; abstain: bigint }
  byWallet: { for: number; against: number; abstain: number }
}

/**
 * Pour chaque proposition, retourne la répartition des votes (Oui/Non/Abstention)
 * en pouvoir de vote (weight) et en nombre de wallets.
 * Permet aussi de dériver le nombre total de votants (somme byWallet).
 */
export async function fetchVoteBreakdownByProposal(): Promise<
  Map<string, VoteBreakdown>
> {
  const logs = await publicClient.getContractEvents({
    address: GOVERNANCE_CONTRACTS.Governor as `0x${string}`,
    abi: GOVERNOR_ABI,
    eventName: 'VoteCast',
    fromBlock: 0n,
  })

  const byProposal = new Map<
    string,
    {
      power: { for: bigint; against: bigint; abstain: bigint }
      walletFor: Set<string>
      walletAgainst: Set<string>
      walletAbstain: Set<string>
    }
  >()

  for (const log of logs) {
    const args = log.args as {
      voter: string
      proposalId: bigint
      support: number
      weight: bigint
    }
    const proposalId = String(args.proposalId)
    const voter = (args.voter ?? '').toLowerCase()
    const weight = args.weight ?? 0n
    const support = Number(args.support ?? 0)

    if (!byProposal.has(proposalId)) {
      byProposal.set(proposalId, {
        power: { for: 0n, against: 0n, abstain: 0n },
        walletFor: new Set(),
        walletAgainst: new Set(),
        walletAbstain: new Set(),
      })
    }
    const entry = byProposal.get(proposalId)!

    if (support === 1) {
      entry.power.for += weight
      entry.walletFor.add(voter)
    } else if (support === 0) {
      entry.power.against += weight
      entry.walletAgainst.add(voter)
    } else {
      entry.power.abstain += weight
      entry.walletAbstain.add(voter)
    }
  }

  const result = new Map<string, VoteBreakdown>()
  byProposal.forEach((entry, proposalId) => {
    result.set(proposalId, {
      byPower: { ...entry.power },
      byWallet: {
        for: entry.walletFor.size,
        against: entry.walletAgainst.size,
        abstain: entry.walletAbstain.size,
      },
    })
  })
  return result
}

/**
 * Compte le nombre de wallets distincts ayant voté pour chaque proposition.
 * Dérivé de fetchVoteBreakdownByProposal pour éviter un double appel RPC.
 */
export function voterCountFromBreakdown(
  breakdown: Map<string, VoteBreakdown>
): Map<string, number> {
  const result = new Map<string, number>()
  breakdown.forEach((b, proposalId) => {
    result.set(
      proposalId,
      b.byWallet.for + b.byWallet.against + b.byWallet.abstain
    )
  })
  return result
}
