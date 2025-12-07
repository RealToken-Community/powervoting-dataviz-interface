/**
 * Transforme les données CSV aplaties en structure JSON imbriquée
 * pour correspondre au format attendu par le dataStore
 */

export interface FlatCSVRow {
  [key: string]: any
}

export interface TransformedBalance {
  walletAddress: string
  type: string
  totalBalanceRegGnosis?: string
  totalBalanceRegEthereum?: string
  totalBalanceRegPolygon?: string
  totalBalanceEquivalentRegGnosis?: string
  totalBalanceEquivalentRegEthereum?: string
  totalBalanceEquivalentRegPolygon?: string
  totalBalanceEquivalentREG?: string
  totalBalanceREG: string
  totalBalance?: string
  sourceBalance?: {
    [network: string]: {
      walletBalance?: string
      vaultIncentiveV1?: string
      dexs?: {
        [dexName: string]: Array<{
          tokenBalance?: string
          tokenSymbol?: string
          tokenDecimals?: string
          tokenAddress?: string
          poolAddress?: string
          equivalentREG?: string
          positionId?: string
          tokenPosition?: string
          isActive?: boolean | string
          tickLower?: number | string
          tickUpper?: number | string
          currentTick?: number | string
          currentPrice?: string
          minPrice?: string
          maxPrice?: string
        }>
      }
    }
  }
}

/**
 * Parse une clé CSV aplatie (ex: "sourceBalance->gnosis->dexs->sushiswap->0->tokenBalance")
 * et retourne les parties: [network, dex, index, field]
 */
function parseCSVKey(key: string): {
  network?: string
  dex?: string
  index?: number
  field?: string
  isDirectField?: boolean
} | null {
  // Clés directes (non imbriquées)
  if (!key.includes('->')) {
    return { isDirectField: true }
  }

  const parts = key.split('->')
  
  // Format: sourceBalance->{network}->dexs->{dex}->{index}->{field}
  if (parts.length >= 6 && parts[0] === 'sourceBalance' && parts[2] === 'dexs') {
    const network = parts[1]
    const dex = parts[3]
    const index = parseInt(parts[4], 10)
    const field = parts.slice(5).join('->')
    
    if (!isNaN(index) && network && dex && field) {
      return { network, dex, index, field }
    }
  }
  
  // Format: sourceBalance->{network}->{field} (walletBalance, vaultIncentiveV1, dexs)
  if (parts.length === 3 && parts[0] === 'sourceBalance') {
    const network = parts[1]
    const field = parts[2]
    return { network, field, isDirectField: false }
  }

  return null
}

/**
 * Transforme un tableau de lignes CSV aplaties en structure JSON imbriquée
 */
export function transformCSVToJSON(csvData: FlatCSVRow[]): TransformedBalance[] {
  return csvData.map((row) => {
    const transformed: TransformedBalance = {
      walletAddress: row.walletAddress || '',
      type: row.type || 'wallet',
      totalBalanceREG: row.totalBalanceREG || row.totalBalance || '0',
      totalBalance: row.totalBalance || row.totalBalanceREG || '0',
    }

    // Copier les champs directs
    if (row.totalBalanceRegGnosis !== undefined) transformed.totalBalanceRegGnosis = String(row.totalBalanceRegGnosis)
    if (row.totalBalanceRegEthereum !== undefined) transformed.totalBalanceRegEthereum = String(row.totalBalanceRegEthereum)
    if (row.totalBalanceRegPolygon !== undefined) transformed.totalBalanceRegPolygon = String(row.totalBalanceRegPolygon)
    if (row.totalBalanceEquivalentRegGnosis !== undefined) transformed.totalBalanceEquivalentRegGnosis = String(row.totalBalanceEquivalentRegGnosis)
    if (row.totalBalanceEquivalentRegEthereum !== undefined) transformed.totalBalanceEquivalentRegEthereum = String(row.totalBalanceEquivalentRegEthereum)
    if (row.totalBalanceEquivalentRegPolygon !== undefined) transformed.totalBalanceEquivalentRegPolygon = String(row.totalBalanceEquivalentRegPolygon)
    if (row.totalBalanceEquivalentREG !== undefined) transformed.totalBalanceEquivalentREG = String(row.totalBalanceEquivalentREG)

    // Initialiser sourceBalance
    transformed.sourceBalance = {}

    // Parcourir toutes les clés pour trouver les données imbriquées
    const positionsByNetworkDex: Record<string, Record<string, Record<number, any>>> = {}
    const networkFields: Record<string, Record<string, any>> = {}

    Object.keys(row).forEach((key) => {
      if (key.startsWith('sourceBalance->')) {
        const parsed = parseCSVKey(key)
        if (!parsed) return

        const value = row[key]
        
        // Ignorer les valeurs vides, null, undefined, ou objets vides
        if (value === null || value === undefined || value === '' || 
            value === '{}' || value === 'null' ||
            (typeof value === 'object' && Object.keys(value).length === 0)) {
          return
        }

        if (parsed.isDirectField) {
          // Clé directe, déjà gérée
          return
        }

        if (parsed.network && parsed.dex !== undefined && parsed.index !== undefined && parsed.field) {
          // Position de pool: sourceBalance->{network}->dexs->{dex}->{index}->{field}
          const network = parsed.network
          const dex = parsed.dex
          const index = parsed.index
          const field = parsed.field

          if (!positionsByNetworkDex[network]) {
            positionsByNetworkDex[network] = {}
          }
          if (!positionsByNetworkDex[network][dex]) {
            positionsByNetworkDex[network][dex] = {}
          }
          if (!positionsByNetworkDex[network][dex][index]) {
            positionsByNetworkDex[network][dex][index] = {}
          }

          positionsByNetworkDex[network][dex][index][field] = value
        } else if (parsed.network && parsed.field && !parsed.dex) {
          // Champ réseau direct: sourceBalance->{network}->{field}
          const network = parsed.network
          const field = parsed.field

          if (!networkFields[network]) {
            networkFields[network] = {}
          }

          networkFields[network][field] = value
        }
      }
    })

    // Construire la structure sourceBalance
    Object.keys(positionsByNetworkDex).forEach((network) => {
      if (!transformed.sourceBalance![network]) {
        transformed.sourceBalance![network] = {
          walletBalance: networkFields[network]?.walletBalance || '0',
          vaultIncentiveV1: networkFields[network]?.vaultIncentiveV1 || '0',
          dexs: {},
        }
      }

      Object.keys(positionsByNetworkDex[network]).forEach((dex) => {
        const positions = positionsByNetworkDex[network][dex]
        const positionArray: any[] = []

        // Convertir l'objet indexé en tableau, en ne gardant que les positions non vides
        Object.keys(positions)
          .map((idx) => parseInt(idx, 10))
          .sort((a, b) => a - b)
          .forEach((index) => {
            const position = positions[index]
            
            // Vérifier si la position a au moins un champ non vide
            const hasData = Object.values(position).some(
              (val) => val !== null && val !== undefined && val !== ''
            )
            
            if (hasData) {
              // Convertir isActive en boolean si c'est une string
              if (position.isActive !== undefined) {
                if (typeof position.isActive === 'string') {
                  position.isActive = position.isActive.toLowerCase() === 'true' || position.isActive === '1'
                } else {
                  position.isActive = Boolean(position.isActive)
                }
              }

              // Convertir les nombres
              if (position.tickLower !== undefined && position.tickLower !== null && position.tickLower !== '') {
                position.tickLower = typeof position.tickLower === 'string' 
                  ? parseInt(position.tickLower, 10) 
                  : Number(position.tickLower)
              }
              if (position.tickUpper !== undefined && position.tickUpper !== null && position.tickUpper !== '') {
                position.tickUpper = typeof position.tickUpper === 'string' 
                  ? parseInt(position.tickUpper, 10) 
                  : Number(position.tickUpper)
              }
              if (position.currentTick !== undefined && position.currentTick !== null && position.currentTick !== '') {
                position.currentTick = typeof position.currentTick === 'string' 
                  ? parseInt(position.currentTick, 10) 
                  : Number(position.currentTick)
              }

              positionArray.push(position)
            }
          })

        if (positionArray.length > 0) {
          transformed.sourceBalance![network].dexs![dex] = positionArray
        }
      })
    })

    // Ajouter les réseaux qui n'ont que des champs directs (sans positions de pools)
    Object.keys(networkFields).forEach((network) => {
      if (!transformed.sourceBalance![network]) {
        transformed.sourceBalance![network] = {
          walletBalance: networkFields[network].walletBalance || '0',
          vaultIncentiveV1: networkFields[network].vaultIncentiveV1 || '0',
          dexs: {},
        }
      }
    })

    return transformed
  })
}

/**
 * Transforme les données powerVoting CSV en format attendu
 */
export function transformPowerVotingCSV(csvData: FlatCSVRow[]): Array<{ address: string; powerVoting: string }> {
  return csvData.map((row) => ({
    address: row.address || '',
    powerVoting: String(row.powerVoting || '0'),
  }))
}

