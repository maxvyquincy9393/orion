import { Prisma, type PrismaClient } from "@prisma/client"

import { prisma } from "../database/index.js"
import { createLogger } from "../logger.js"
import {
  buildHyperEdgeDedupeKey,
  chooseCanonicalHyperEdge,
  chooseCanonicalNode,
  chooseMergedHyperEdgeContext,
  computeHyperEdgeMemberSetHash,
  groupDuplicateCausalNodes,
  groupDuplicateHyperEdges,
  normalizeCausalEventKey,
} from "../memory/causal-graph-dedupe-utils.js"

const log = createLogger("cli.causal-graph-dedupe")

interface CliOptions {
  apply: boolean
  userId: string | null
  limitGroups: number | null
  verbose: boolean
}

interface DedupeStats {
  scannedNodes: number
  nodeEventKeysBackfilled: number
  duplicateNodeGroups: number
  duplicateNodesRemoved: number
  edgeRefsUpdated: number
  edgeSelfLoopsRemoved: number
  edgesMerged: number
  membershipsRepointed: number
  membershipsDeduped: number
  scannedHyperEdges: number
  hyperEdgeHashesBackfilled: number
  duplicateHyperEdgeGroups: number
  duplicateHyperEdgesRemoved: number
  hyperEdgesMerged: number
}

interface Stage3Readiness {
  missingNodeEventKeys: number
  remainingDuplicateNodeGroups: number
  missingHyperEdgeMemberSetHashes: number
  remainingDuplicateHyperEdgeGroups: number
  ready: boolean
}

type TxClient = Prisma.TransactionClient

interface CountRow {
  count: number | bigint
}

function parseCliArgs(argv: string[]): CliOptions {
  let apply = false
  let userId: string | null = null
  let limitGroups: number | null = null
  let verbose = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === "--apply") {
      apply = true
      continue
    }
    if (arg === "--dry-run") {
      apply = false
      continue
    }
    if (arg === "--verbose") {
      verbose = true
      continue
    }
    if (arg === "--user" && argv[i + 1]) {
      userId = argv[i + 1] ?? null
      i += 1
      continue
    }
    if (arg.startsWith("--user=")) {
      userId = arg.slice("--user=".length) || null
      continue
    }
    if (arg === "--limit-groups" && argv[i + 1]) {
      limitGroups = Number.parseInt(argv[i + 1] ?? "", 10)
      i += 1
      continue
    }
    if (arg.startsWith("--limit-groups=")) {
      limitGroups = Number.parseInt(arg.slice("--limit-groups=".length), 10)
      continue
    }
    if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    }
  }

  if (limitGroups !== null && (!Number.isFinite(limitGroups) || limitGroups <= 0)) {
    throw new Error(`Invalid --limit-groups value: ${String(limitGroups)}`)
  }

  return { apply, userId, limitGroups, verbose }
}

function printHelp(): void {
  console.log("Causal Graph Dedupe")
  console.log("==================")
  console.log("")
  console.log("Usage:")
  console.log("  pnpm exec tsx src/cli/causal-graph-dedupe.ts [--dry-run] [--apply] [--user <id>] [--limit-groups N] [--verbose]")
  console.log("")
  console.log("Options:")
  console.log("  --dry-run        Analyze and print summary without writing (default)")
  console.log("  --apply          Execute dedupe writes")
  console.log("  --user <id>      Scope to one userId")
  console.log("  --limit-groups   Max duplicate groups to process per phase")
  console.log("  --verbose        Emit per-group progress")
}

function initStats(): DedupeStats {
  return {
    scannedNodes: 0,
    nodeEventKeysBackfilled: 0,
    duplicateNodeGroups: 0,
    duplicateNodesRemoved: 0,
    edgeRefsUpdated: 0,
    edgeSelfLoopsRemoved: 0,
    edgesMerged: 0,
    membershipsRepointed: 0,
    membershipsDeduped: 0,
    scannedHyperEdges: 0,
    hyperEdgeHashesBackfilled: 0,
    duplicateHyperEdgeGroups: 0,
    duplicateHyperEdgesRemoved: 0,
    hyperEdgesMerged: 0,
  }
}

function chooseMergedStrength(a: number, b: number): number {
  return Math.max(a, b)
}

function chooseMergedEvidence(a: number, b: number): number {
  return Math.max(1, (Number.isFinite(a) ? a : 0) + (Number.isFinite(b) ? b : 0))
}

function coerceCount(rows: CountRow[]): number {
  const value = rows[0]?.count ?? 0
  if (typeof value === "bigint") {
    return Number(value)
  }
  return Number.isFinite(value) ? value : 0
}

async function collectStage3Readiness(client: PrismaClient, options: CliOptions): Promise<Stage3Readiness> {
  const nodeFilter = options.userId
    ? Prisma.sql` AND "userId" = ${options.userId}`
    : Prisma.empty
  const edgeFilter = options.userId
    ? Prisma.sql` AND "userId" = ${options.userId}`
    : Prisma.empty

  const missingNodeEventKeys = coerceCount(
    await client.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM "CausalNode"
      WHERE ("eventKey" IS NULL OR TRIM("eventKey") = '')
      ${nodeFilter}
    `),
  )

  const remainingDuplicateNodeGroups = coerceCount(
    await client.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM (
        SELECT 1
        FROM "CausalNode"
        WHERE "eventKey" IS NOT NULL AND TRIM("eventKey") <> ''
        ${nodeFilter}
        GROUP BY "userId", "eventKey"
        HAVING COUNT(*) > 1
      ) AS duplicate_groups
    `),
  )

  const missingHyperEdgeMemberSetHashes = coerceCount(
    await client.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM "HyperEdge"
      WHERE ("memberSetHash" IS NULL OR TRIM("memberSetHash") = '')
      ${edgeFilter}
    `),
  )

  const remainingDuplicateHyperEdgeGroups = coerceCount(
    await client.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*) AS count
      FROM (
        SELECT 1
        FROM "HyperEdge"
        WHERE "memberSetHash" IS NOT NULL AND TRIM("memberSetHash") <> ''
        ${edgeFilter}
        GROUP BY "userId", "relation", "memberSetHash"
        HAVING COUNT(*) > 1
      ) AS duplicate_groups
    `),
  )

  const ready =
    missingNodeEventKeys === 0 &&
    remainingDuplicateNodeGroups === 0 &&
    missingHyperEdgeMemberSetHashes === 0 &&
    remainingDuplicateHyperEdgeGroups === 0

  return {
    missingNodeEventKeys,
    remainingDuplicateNodeGroups,
    missingHyperEdgeMemberSetHashes,
    remainingDuplicateHyperEdgeGroups,
    ready,
  }
}

async function repointDuplicateNodeReferences(
  tx: TxClient,
  duplicateNodeId: string,
  canonicalNodeId: string,
  stats: DedupeStats,
): Promise<void> {
  const edges = await tx.causalEdge.findMany({
    where: {
      OR: [
        { fromId: duplicateNodeId },
        { toId: duplicateNodeId },
      ],
    },
    select: {
      id: true,
      fromId: true,
      toId: true,
      strength: true,
      evidence: true,
      userId: true,
    },
  })

  for (const edge of edges) {
    const nextFromId = edge.fromId === duplicateNodeId ? canonicalNodeId : edge.fromId
    const nextToId = edge.toId === duplicateNodeId ? canonicalNodeId : edge.toId

    if (nextFromId === nextToId) {
      await tx.causalEdge.delete({ where: { id: edge.id } })
      stats.edgeSelfLoopsRemoved += 1
      continue
    }

    const existingTarget = await tx.causalEdge.findUnique({
      where: {
        fromId_toId: {
          fromId: nextFromId,
          toId: nextToId,
        },
      },
      select: {
        id: true,
        strength: true,
        evidence: true,
      },
    })

    if (existingTarget && existingTarget.id !== edge.id) {
      await tx.causalEdge.update({
        where: { id: existingTarget.id },
        data: {
          strength: chooseMergedStrength(existingTarget.strength, edge.strength),
          evidence: chooseMergedEvidence(existingTarget.evidence, edge.evidence),
        },
      })
      await tx.causalEdge.delete({ where: { id: edge.id } })
      stats.edgesMerged += 1
      continue
    }

    await tx.causalEdge.update({
      where: { id: edge.id },
      data: {
        fromId: nextFromId,
        toId: nextToId,
      },
    })
    stats.edgeRefsUpdated += 1
  }

  const memberships = await tx.hyperEdgeMembership.findMany({
    where: {
      nodeId: duplicateNodeId,
    },
    select: {
      hyperEdgeId: true,
      nodeId: true,
    },
  })

  for (const membership of memberships) {
    const canonicalMembership = await tx.hyperEdgeMembership.findUnique({
      where: {
        hyperEdgeId_nodeId: {
          hyperEdgeId: membership.hyperEdgeId,
          nodeId: canonicalNodeId,
        },
      },
      select: {
        hyperEdgeId: true,
        nodeId: true,
      },
    })

    if (canonicalMembership) {
      await tx.hyperEdgeMembership.delete({
        where: {
          hyperEdgeId_nodeId: {
            hyperEdgeId: membership.hyperEdgeId,
            nodeId: duplicateNodeId,
          },
        },
      })
      stats.membershipsDeduped += 1
      continue
    }

    await tx.hyperEdgeMembership.create({
      data: {
        hyperEdgeId: membership.hyperEdgeId,
        nodeId: canonicalNodeId,
      },
    })
    await tx.hyperEdgeMembership.delete({
      where: {
        hyperEdgeId_nodeId: {
          hyperEdgeId: membership.hyperEdgeId,
          nodeId: duplicateNodeId,
        },
      },
    })
    stats.membershipsRepointed += 1
  }
}

async function backfillNodeEventKeysPhase(
  client: PrismaClient,
  options: CliOptions,
  stats: DedupeStats,
): Promise<void> {
  const nodes = await client.causalNode.findMany({
    where: options.userId ? { userId: options.userId } : undefined,
    select: {
      id: true,
      event: true,
      eventKey: true,
    },
    orderBy: {
      id: "asc",
    },
  })

  for (const node of nodes) {
    const nextEventKey = normalizeCausalEventKey(node.event)
    if (!nextEventKey || node.eventKey === nextEventKey) {
      continue
    }

    stats.nodeEventKeysBackfilled += 1
    if (!options.apply) {
      continue
    }

    await client.causalNode.update({
      where: { id: node.id },
      data: { eventKey: nextEventKey },
    })
  }
}

async function backfillHyperEdgeHashesPhase(
  client: PrismaClient,
  options: CliOptions,
  stats: DedupeStats,
): Promise<void> {
  const edges = await client.hyperEdge.findMany({
    where: options.userId ? { userId: options.userId } : undefined,
    include: {
      members: {
        select: { nodeId: true },
      },
    },
    orderBy: {
      id: "asc",
    },
  })

  for (const edge of edges) {
    const nextHash = computeHyperEdgeMemberSetHash(edge.relation, edge.members.map((member) => member.nodeId))
    if (edge.memberSetHash === nextHash) {
      continue
    }

    stats.hyperEdgeHashesBackfilled += 1
    if (!options.apply) {
      continue
    }

    await client.hyperEdge.update({
      where: { id: edge.id },
      data: { memberSetHash: nextHash },
    })
  }
}

async function dedupeCausalNodesPhase(
  client: PrismaClient,
  options: CliOptions,
  stats: DedupeStats,
): Promise<void> {
  const nodes = await client.causalNode.findMany({
    where: options.userId ? { userId: options.userId } : undefined,
    select: {
      id: true,
      userId: true,
      event: true,
      createdAt: true,
    },
    orderBy: [
      { createdAt: "asc" },
      { id: "asc" },
    ],
  })

  stats.scannedNodes = nodes.length
  const duplicateGroups = groupDuplicateCausalNodes(nodes)
  const groupsToProcess = options.limitGroups
    ? duplicateGroups.slice(0, options.limitGroups)
    : duplicateGroups
  stats.duplicateNodeGroups = groupsToProcess.length

  for (const [index, group] of groupsToProcess.entries()) {
    const canonical = chooseCanonicalNode(group.nodes)
    if (!canonical) {
      continue
    }

    const duplicateNodes = group.nodes.filter((node) => node.id !== canonical.id)
    if (duplicateNodes.length === 0) {
      continue
    }

    if (options.verbose) {
      log.info("node dedupe group", {
        index: index + 1,
        total: groupsToProcess.length,
        userId: group.userId,
        eventKey: group.eventKey,
        canonicalId: canonical.id,
        duplicateCount: duplicateNodes.length,
      })
    }

    if (!options.apply) {
      stats.duplicateNodesRemoved += duplicateNodes.length
      continue
    }

    await client.$transaction(async (tx) => {
      for (const duplicate of duplicateNodes) {
        await repointDuplicateNodeReferences(tx, duplicate.id, canonical.id, stats)
        await tx.causalNode.delete({ where: { id: duplicate.id } })
        stats.duplicateNodesRemoved += 1
      }
    })
  }
}

function normalizeHyperEdgeContextForMerge(context: string): string {
  return context.trim().slice(0, 500)
}

async function dedupeHyperEdgesPhase(
  client: PrismaClient,
  options: CliOptions,
  stats: DedupeStats,
): Promise<void> {
  const hyperEdges = await client.hyperEdge.findMany({
    where: options.userId ? { userId: options.userId } : undefined,
    include: {
      members: {
        select: { nodeId: true },
      },
    },
    orderBy: {
      id: "asc",
    },
  })

  stats.scannedHyperEdges = hyperEdges.length

  const duplicateGroups = groupDuplicateHyperEdges(hyperEdges.map((edge) => ({
    id: edge.id,
    userId: edge.userId,
    relation: edge.relation,
    context: edge.context,
    weight: edge.weight,
    memberNodeIds: edge.members.map((member) => member.nodeId),
  })))

  const groupsToProcess = options.limitGroups
    ? duplicateGroups.slice(0, options.limitGroups)
    : duplicateGroups
  stats.duplicateHyperEdgeGroups = groupsToProcess.length

  for (const [index, group] of groupsToProcess.entries()) {
    const canonical = chooseCanonicalHyperEdge(group.edges)
    if (!canonical) {
      continue
    }
    const duplicates = group.edges.filter((edge) => edge.id !== canonical.id)
    if (duplicates.length === 0) {
      continue
    }

    if (options.verbose) {
      log.info("hyperedge dedupe group", {
        index: index + 1,
        total: groupsToProcess.length,
        userId: group.userId,
        relationKey: group.relationKey,
        memberSetHash: group.memberSetHash,
        canonicalId: canonical.id,
        duplicateCount: duplicates.length,
      })
    }

    if (!options.apply) {
      stats.duplicateHyperEdgesRemoved += duplicates.length
      stats.hyperEdgesMerged += duplicates.length
      continue
    }

    await client.$transaction(async (tx) => {
      const mergedWeight = Math.max(canonical.weight, ...duplicates.map((item) => item.weight))
      const mergedContext = chooseMergedHyperEdgeContext([
        canonical.context,
        ...duplicates.map((item) => item.context),
      ])
      const memberSetHash = computeHyperEdgeMemberSetHash(canonical.relation, canonical.memberNodeIds)

      await tx.hyperEdge.update({
        where: { id: canonical.id },
        data: {
          weight: mergedWeight,
          context: normalizeHyperEdgeContextForMerge(mergedContext),
          memberSetHash,
        },
      })

      for (const duplicate of duplicates) {
        await tx.hyperEdgeMembership.deleteMany({
          where: {
            hyperEdgeId: duplicate.id,
          },
        })
        await tx.hyperEdge.delete({
          where: { id: duplicate.id },
        })
        stats.duplicateHyperEdgesRemoved += 1
        stats.hyperEdgesMerged += 1
      }
    })
  }
}

async function summarizePotentialNewColumns(
  client: PrismaClient,
  options: CliOptions,
): Promise<void> {
  const sampleNodes = await client.causalNode.findMany({
    where: options.userId ? { userId: options.userId } : undefined,
    select: {
      id: true,
      userId: true,
      event: true,
      createdAt: true,
    },
    take: 5,
    orderBy: {
      createdAt: "asc",
    },
  })

  const sampleHyperEdges = await client.hyperEdge.findMany({
    where: options.userId ? { userId: options.userId } : undefined,
    include: {
      members: { select: { nodeId: true } },
    },
    take: 5,
    orderBy: { id: "asc" },
  })

  if (sampleNodes.length > 0) {
    console.log("")
    console.log("Sample derived eventKey values:")
    for (const node of sampleNodes) {
      console.log(`- ${node.id} -> ${normalizeCausalEventKey(node.event)}`)
    }
  }

  if (sampleHyperEdges.length > 0) {
    console.log("")
    console.log("Sample derived memberSetHash values:")
    for (const edge of sampleHyperEdges) {
      const memberIds = edge.members.map((member) => member.nodeId)
      console.log(`- ${edge.id} -> ${computeHyperEdgeMemberSetHash(edge.relation, memberIds)} (${buildHyperEdgeDedupeKey(edge.userId, edge.relation, memberIds)})`)
    }
  }
}

function printSummary(options: CliOptions, stats: DedupeStats, readiness: Stage3Readiness): void {
  console.log("")
  console.log("Causal Graph Dedupe Summary")
  console.log("==========================")
  console.log(`Mode: ${options.apply ? "APPLY" : "DRY-RUN"}`)
  if (options.userId) {
    console.log(`User: ${options.userId}`)
  }
  if (options.limitGroups) {
    console.log(`Group limit: ${options.limitGroups}`)
  }
  console.log("")
  console.log(`Nodes scanned: ${stats.scannedNodes}`)
  console.log(`Node eventKey backfilled (or planned): ${stats.nodeEventKeysBackfilled}`)
  console.log(`Duplicate node groups: ${stats.duplicateNodeGroups}`)
  console.log(`Duplicate nodes removed (or planned): ${stats.duplicateNodesRemoved}`)
  console.log(`Causal edge refs updated: ${stats.edgeRefsUpdated}`)
  console.log(`Causal edges merged: ${stats.edgesMerged}`)
  console.log(`Self-loop edges removed: ${stats.edgeSelfLoopsRemoved}`)
  console.log(`HyperEdge memberships repointed: ${stats.membershipsRepointed}`)
  console.log(`HyperEdge memberships deduped: ${stats.membershipsDeduped}`)
  console.log("")
  console.log(`HyperEdges scanned: ${stats.scannedHyperEdges}`)
  console.log(`HyperEdge memberSetHash backfilled (or planned): ${stats.hyperEdgeHashesBackfilled}`)
  console.log(`Duplicate hyperedge groups: ${stats.duplicateHyperEdgeGroups}`)
  console.log(`Duplicate hyperedges removed (or planned): ${stats.duplicateHyperEdgesRemoved}`)
  console.log(`Hyperedge merges applied (or planned): ${stats.hyperEdgesMerged}`)
  console.log("")
  console.log("Stage-3 Readiness (non-null + unique constraints)")
  console.log("-----------------------------------------------")
  console.log(`Missing node eventKey rows: ${readiness.missingNodeEventKeys}`)
  console.log(`Remaining duplicate node groups: ${readiness.remainingDuplicateNodeGroups}`)
  console.log(`Missing hyperedge memberSetHash rows: ${readiness.missingHyperEdgeMemberSetHashes}`)
  console.log(`Remaining duplicate hyperedge groups: ${readiness.remainingDuplicateHyperEdgeGroups}`)
  console.log(`Ready for Stage-3 migration: ${readiness.ready ? "YES" : "NO"}`)
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2))
  const stats = initStats()

  log.info("starting causal graph dedupe", {
    mode: options.apply ? "apply" : "dry-run",
    userId: options.userId,
    limitGroups: options.limitGroups,
  })

  try {
    await prisma.$connect()
    await backfillNodeEventKeysPhase(prisma, options, stats)
    await dedupeCausalNodesPhase(prisma, options, stats)
    await backfillHyperEdgeHashesPhase(prisma, options, stats)
    await dedupeHyperEdgesPhase(prisma, options, stats)
    const readiness = await collectStage3Readiness(prisma, options)
    await summarizePotentialNewColumns(prisma, options)
    printSummary(options, stats, readiness)
  } finally {
    await prisma.$disconnect().catch((error) => log.warn("prisma disconnect failed", error))
  }
}

void main().catch((error) => {
  log.error("causal graph dedupe failed", error)
  process.exit(1)
})
