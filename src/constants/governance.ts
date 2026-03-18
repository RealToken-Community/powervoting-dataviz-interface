/**
 * Smart contracts de la DAO RealToken (Gnosis)
 */
export const GNOSIS_CHAIN_ID = 100

export const GOVERNANCE_CONTRACTS = {
  /** Governor – propositions et votes */
  Governor: '0x4a5327347f077e72d2aab19f68ba8a7f12ec5d63' as const,
  /** Token de vote (Power Voting Registry) – pour getPastTotalSupply au moment du vote */
  Token: '0x6382856a731Af535CA6aea8D364FCE67457da438' as const,
} as const
