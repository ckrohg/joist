#!/usr/bin/env node
/**
 * @purpose _grade-fused-selftest.mjs — the STANDALONE falsifier for grade-fused.mjs. The orchestrator re-executes
 * THIS (the builder does NOT self-bless). It imports runSelftest() from grade-fused.mjs and runs the 5 mandated
 * offline checks (NO capture, NO vision): self-clone→100/empty-ledger/no-veto; injected blank-hero with
 * cropResults=null → deterministic veto trips + fusedScore≤8 (the floor moved off vision); dedup-merge; bounded
 * vision clamp; full traceability. Exit 0 = ALL PASS.
 */
import { runSelftest } from './grade-fused.mjs';
process.exit(runSelftest() ? 0 : 1);
