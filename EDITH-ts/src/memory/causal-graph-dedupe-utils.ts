import { createHash } from "node:crypto"

export interface CausalNodeDedupeCandidate {
  id: string
  userId: string
  event: string
  createdAt: Date
}

export interface HyperEdgeDedupeCandidate {
  id: string
  userId: string
  relation: string
  context: string
  weight: number
  memberNodeIds: string[]
}

export function normalizeCausalEventKey(event: string): string {
  return event.trim().toLowerCase().replace(/\s+/g, " ")
}

export function normalizeHyperEdgeRelationKey(relation: string): string {
  return relation.trim().toLowerCase().replace(/\s+/g, " ")
}

export function stableSortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b))
}

export function buildHyperEdgeMemberSetKey(memberNodeIds: string[]): string {
  return stableSortedUnique(memberNodeIds).join("|")
}

export function buildHyperEdgeDedupeKey(userId: string, relation: string, memberNodeIds: string[]): string {
  return [
    userId,
    normalizeHyperEdgeRelationKey(relation),
    buildHyperEdgeMemberSetKey(memberNodeIds),
  ].join("::")
}

export function computeHyperEdgeMemberSetHash(relation: string, memberNodeIds: string[]): string {
  const canonical = `${normalizeHyperEdgeRelationKey(relation)}::${buildHyperEdgeMemberSetKey(memberNodeIds)}`
  return createHash("sha256").update(canonical).digest("hex")
}

export function compareCanonicalOrder(
  left: Pick<CausalNodeDedupeCandidate, "id" | "createdAt">,
  right: Pick<CausalNodeDedupeCandidate, "id" | "createdAt">,
): number {
  const byDate = left.createdAt.getTime() - right.createdAt.getTime()
  if (byDate !== 0) {
    return byDate
  }
  return left.id.localeCompare(right.id)
}

export function chooseCanonicalNode(candidates: CausalNodeDedupeCandidate[]): CausalNodeDedupeCandidate | null {
  if (candidates.length === 0) {
    return null
  }
  return [...candidates].sort(compareCanonicalOrder)[0] ?? null
}

export function chooseCanonicalHyperEdge(candidates: HyperEdgeDedupeCandidate[]): HyperEdgeDedupeCandidate | null {
  if (candidates.length === 0) {
    return null
  }

  return [...candidates].sort((a, b) => a.id.localeCompare(b.id))[0] ?? null
}

export function chooseMergedHyperEdgeContext(contexts: string[]): string {
  const clean = contexts
    .map((value) => value.trim())
    .filter(Boolean)

  if (clean.length === 0) {
    return ""
  }

  // Prefer longer context because HyperEdge lacks createdAt/updatedAt.
  return clean.sort((a, b) => {
    if (b.length !== a.length) {
      return b.length - a.length
    }
    return a.localeCompare(b)
  })[0] ?? ""
}

export interface CausalNodeDedupeGroup {
  userId: string
  eventKey: string
  nodes: CausalNodeDedupeCandidate[]
}

export function groupDuplicateCausalNodes(nodes: CausalNodeDedupeCandidate[]): CausalNodeDedupeGroup[] {
  const groups = new Map<string, CausalNodeDedupeCandidate[]>()

  for (const node of nodes) {
    const eventKey = normalizeCausalEventKey(node.event)
    if (!eventKey) {
      continue
    }
    const key = `${node.userId}::${eventKey}`
    const existing = groups.get(key)
    if (existing) {
      existing.push(node)
    } else {
      groups.set(key, [node])
    }
  }

  return Array.from(groups.entries())
    .filter(([, candidates]) => candidates.length > 1)
    .map(([groupKey, candidates]) => {
      const [userId, ...eventKeyParts] = groupKey.split("::")
      return {
        userId,
        eventKey: eventKeyParts.join("::"),
        nodes: [...candidates].sort(compareCanonicalOrder),
      }
    })
}

export interface HyperEdgeDedupeGroup {
  userId: string
  relationKey: string
  memberSetHash: string
  edges: HyperEdgeDedupeCandidate[]
}

export function groupDuplicateHyperEdges(edges: HyperEdgeDedupeCandidate[]): HyperEdgeDedupeGroup[] {
  const groups = new Map<string, HyperEdgeDedupeCandidate[]>()

  for (const edge of edges) {
    const key = buildHyperEdgeDedupeKey(edge.userId, edge.relation, edge.memberNodeIds)
    const existing = groups.get(key)
    if (existing) {
      existing.push(edge)
    } else {
      groups.set(key, [edge])
    }
  }

  return Array.from(groups.values())
    .filter((candidates) => candidates.length > 1)
    .map((candidates) => {
      const first = candidates[0]
      return {
        userId: first.userId,
        relationKey: normalizeHyperEdgeRelationKey(first.relation),
        memberSetHash: computeHyperEdgeMemberSetHash(first.relation, first.memberNodeIds),
        edges: [...candidates].sort((a, b) => a.id.localeCompare(b.id)),
      }
    })
}

export const __causalGraphDedupeUtilsTestUtils = {
  normalizeCausalEventKey,
  normalizeHyperEdgeRelationKey,
  stableSortedUnique,
  buildHyperEdgeMemberSetKey,
  buildHyperEdgeDedupeKey,
  computeHyperEdgeMemberSetHash,
  chooseMergedHyperEdgeContext,
}
