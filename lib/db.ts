import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "policytown.db");

declare global {
  var __policyTownDb: DatabaseSync | undefined;
}

function createConnection(): DatabaseSync {
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      config TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      tick INTEGER NOT NULL DEFAULT 0,
      resourceStock INTEGER NOT NULL,
      backlog INTEGER NOT NULL DEFAULT 0
    );

    -- Case ids are derived from the seed (pair-<seed>-<i>-a/b), and the
    -- experiment runner intentionally reuses seeds across episodes (so
    -- control and multi-agent see identical cases). Uniqueness is therefore
    -- scoped PER EPISODE, not globally — a plain PRIMARY KEY on id would
    -- collide the moment two episodes share a seed.
    CREATE TABLE IF NOT EXISTS cases (
      id TEXT NOT NULL,
      episodeId TEXT NOT NULL,
      narrative TEXT NOT NULL,
      trueSeverity INTEGER NOT NULL,
      demographicType TEXT NOT NULL,
      demographicValue TEXT NOT NULL,
      pairId TEXT NOT NULL,
      arrivedAtTick INTEGER NOT NULL,
      PRIMARY KEY (episodeId, id)
    );

    CREATE TABLE IF NOT EXISTS agent_decisions (
      id TEXT PRIMARY KEY,
      episodeId TEXT NOT NULL,
      agentId TEXT NOT NULL,
      agentRole TEXT NOT NULL,
      caseId TEXT NOT NULL,
      action TEXT NOT NULL,
      rationale TEXT NOT NULL,
      tick INTEGER NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS policy_checks (
      id TEXT PRIMARY KEY,
      episodeId TEXT NOT NULL,
      decisionId TEXT NOT NULL,
      policyId INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      checkedBy TEXT NOT NULL,
      rationale TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_cases_episode ON cases(episodeId);
    CREATE INDEX IF NOT EXISTS idx_decisions_episode ON agent_decisions(episodeId);
    CREATE INDEX IF NOT EXISTS idx_decisions_case ON agent_decisions(caseId);
    CREATE INDEX IF NOT EXISTS idx_checks_episode ON policy_checks(episodeId);
    CREATE INDEX IF NOT EXISTS idx_checks_decision ON policy_checks(decisionId);
  `);
  return db;
}

// Reuse one connection across hot reloads in dev (Next.js dev server re-evaluates modules).
export const db = globalThis.__policyTownDb ?? createConnection();
if (process.env.NODE_ENV !== "production") globalThis.__policyTownDb = db;
