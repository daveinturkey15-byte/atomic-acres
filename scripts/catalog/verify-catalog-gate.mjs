#!/usr/bin/env node
/**
 * scripts/catalog/verify-catalog-gate.mjs
 *
 * Self-test suite for the standalone Nuketown 2025 production-catalog gate.
 * Validates queued backlog, runtime gate enforcement, image magic checks,
 * hash matching, path containment, DAG cycles, forged receipts, and mutations.
 * Built-in Node only. Cleans only its own temporary directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  validateCatalog,
  checkImageMagicBytes,
  calculateSha256,
  validateContainedPath,
  detectDependencyCycles
} from './catalog-gate.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CATALOG_GATE_SCRIPT = path.resolve(__dirname, 'catalog-gate.mjs');

// 1x1 valid PNG in base64
const VALID_1X1_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const VALID_1X1_PNG_BUF = Buffer.from(VALID_1X1_PNG_BASE64, 'base64');
const VALID_1X1_PNG_SHA = calculateSha256(VALID_1X1_PNG_BUF);

let testsRun = 0;
let testsPassed = 0;
const failures = [];

function assert(condition, message) {
  testsRun++;
  if (!condition) {
    failures.push(message);
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(message);
  } else {
    testsPassed++;
    console.log(`  ✅ PASS: ${message}`);
  }
}

function runCLI(args) {
  return spawnSync(process.execPath, [CATALOG_GATE_SCRIPT, ...args], {
    encoding: 'utf8'
  });
}

function runSuite() {
  console.log('=== Running Production Catalog Gate Self-Test Suite ===\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuketown-gate-test-'));
  console.log(`Created isolated test scratch directory: ${tmpDir}\n`);

  try {
    // Setup synthetic directory tree
    const imgDir = path.join(tmpDir, 'assets', 'images');
    const modelDir = path.join(tmpDir, 'assets', 'models');
    const runtimeDir = path.join(tmpDir, 'src', 'weapons');
    const receiptDir = path.join(tmpDir, 'docs', 'receipts');

    fs.mkdirSync(imgDir, { recursive: true });
    fs.mkdirSync(modelDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(receiptDir, { recursive: true });

    // 1. Synthetic files
    const validImgPathRel = 'assets/images/an94-front.png';
    const validImgPathAbs = path.join(tmpDir, validImgPathRel);
    fs.writeFileSync(validImgPathAbs, VALID_1X1_PNG_BUF);

    const corruptImgRel = 'assets/images/corrupt.png';
    const corruptImgAbs = path.join(tmpDir, corruptImgRel);
    const corruptImgBuf = Buffer.from('NOT_AN_IMAGE_PLAIN_TEXT_CONTENT');
    fs.writeFileSync(corruptImgAbs, corruptImgBuf);
    const corruptImgSha = calculateSha256(corruptImgBuf);

    const emptyImgRel = 'assets/images/empty.png';
    fs.writeFileSync(path.join(tmpDir, emptyImgRel), Buffer.alloc(0));

    const validModelRel = 'assets/models/an94.glb';
    const validModelAbs = path.join(tmpDir, validModelRel);
    const validModelBuf = Buffer.from('glTF-synthetic-mesh-buffer-content-for-test');
    fs.writeFileSync(validModelAbs, validModelBuf);
    const validModelSha = calculateSha256(validModelBuf);

    const validEntryRel = 'src/weapons/an94.ts';
    const validEntryAbs = path.join(tmpDir, validEntryRel);
    fs.writeFileSync(validEntryAbs, 'export const an94Weapon = { id: "weapon-an94", fireRate: 600 };\n');

    const emptyEntryRel = 'src/weapons/empty.ts';
    fs.writeFileSync(path.join(tmpDir, emptyEntryRel), '');

    const validAssetRel = 'assets/models/an94.glb';

    const validReceiptRel = 'docs/receipts/weapon-an94-receipt.json';
    const validReceiptAbs = path.join(tmpDir, validReceiptRel);
    const validReceiptData = {
      assetId: 'weapon-an94',
      buildHash: 'build-hash-nt-20260919-01',
      outcome: 'pass',
      sourcePath: validEntryRel,
      testedAt: '2026-09-19T17:00:00Z'
    };
    fs.writeFileSync(validReceiptAbs, JSON.stringify(validReceiptData, null, 2));

    // TEST 1: Image Magic Bytes validator
    console.log('[Group 1: Binary Image Magic Validation]');
    assert(checkImageMagicBytes(VALID_1X1_PNG_BUF).ok === true, 'Valid PNG magic bytes detected');
    assert(checkImageMagicBytes(corruptImgBuf).ok === false, 'Text file rejected by image magic bytes check');
    assert(checkImageMagicBytes(Buffer.alloc(0)).ok === false, '0-byte buffer rejected by image check');

    // TEST 2: Path Containment checks
    console.log('\n[Group 2: Contained Path Security]');
    assert(validateContainedPath('assets/images/test.png', tmpDir, 'path').ok === true, 'Relative contained path accepted');
    assert(validateContainedPath('/etc/shadow', tmpDir, 'path').ok === false, 'Root absolute path rejected');
    assert(validateContainedPath('C:\\Windows\\System32', tmpDir, 'path').ok === false, 'Windows absolute drive path rejected');
    assert(validateContainedPath('../escaped.png', tmpDir, 'path').ok === false, 'Leading traversal .. rejected');
    assert(validateContainedPath('assets/../../escaped.png', tmpDir, 'path').ok === false, 'Internal traversal .. escaping root rejected');

    // TEST 3: Queued Backlog Manifest (Valid base, Fails --require-runtime)
    console.log('\n[Group 3: Queued Backlog & Runtime Gate]');
    const queuedManifest = {
      schemaVersion: 1,
      items: [
        {
          id: 'weapon-an94',
          kind: 'weapon',
          displayName: 'AN-94 Assault Rifle',
          referenceSource: 'BO2 theatre frame',
          dependencies: [],
          images: [],
          stage: 'queued',
          model: null,
          runtime: null,
          verification: null,
          owner: 'Astra',
          nextAction: 'Capture isolated orthographic reference plates'
        },
        {
          id: 'streak-uav',
          kind: 'killstreak',
          displayName: 'UAV Recon Plane',
          referenceSource: 'BO2 flyover model',
          dependencies: [],
          images: [],
          stage: 'queued',
          model: null,
          runtime: null,
          verification: null,
          owner: 'Astra',
          nextAction: 'Draft low-poly orbital glider mesh'
        }
      ]
    };

    const resQueuedBase = validateCatalog(queuedManifest, { root: tmpDir, requireRuntime: false });
    assert(resQueuedBase.valid === true, 'Queued manifest passes standard validation with 0 errors');
    assert(resQueuedBase.passed === true, 'Queued manifest passes overall gate when requireRuntime is false');
    assert(resQueuedBase.summary.openBacklogCount === 2, 'Queued manifest correctly tallies 2 open backlog items');

    const resQueuedRuntime = validateCatalog(queuedManifest, { root: tmpDir, requireRuntime: true });
    assert(resQueuedRuntime.valid === true, 'Queued manifest remains syntactically valid under requireRuntime');
    assert(resQueuedRuntime.passed === false, 'Queued manifest fails overall gate under requireRuntime');
    assert(resQueuedRuntime.gateErrors.length > 0, 'Runtime gate error recorded for unverified queued rows');

    const grenadeManifest = {
      items: [{
        id: 'grenade-frag',
        kind: 'grenade',
        displayName: 'Fragmentation Grenade',
        referenceSource: 'production catalog reference sheet',
        dependencies: [],
        images: [],
        stage: 'queued',
        model: null,
        runtime: null,
        verification: null,
        owner: 'Catalog',
        nextAction: 'Capture the four-view reference sheet'
      }]
    };
    const resGrenade = validateCatalog(grenadeManifest, { root: tmpDir, requireRuntime: false });
    assert(resGrenade.valid === true, 'Grenade kind is accepted as a queued catalog row');
    assert(resGrenade.summary.byKind.grenade === 1, 'Grenade kind is counted in the catalog summary');

    // TEST 4: Missing Image Detection
    console.log('\n[Group 4: File & Hash Integrity]');
    const missingImageManifest = {
      schemaVersion: 1,
      items: [
        {
          id: 'weapon-an94',
          kind: 'weapon',
          displayName: 'AN-94',
          referenceSource: 'ref',
          dependencies: [],
          images: [{ path: 'assets/images/non-existent.png', sha256: '0'.repeat(64), role: 'front' }],
          stage: 'reference-generated',
          model: null,
          runtime: null,
          verification: null,
          owner: 'Astra',
          nextAction: 'act'
        }
      ]
    };
    const resMissingImg = validateCatalog(missingImageManifest, { root: tmpDir });
    assert(resMissingImg.valid === false, 'Missing image file fails validation');
    assert(resMissingImg.errors.some(e => e.includes('does not exist')), 'Error explicitly identifies missing image file');

    // TEST 5: Bad Image Hash Detection
    const badHashManifest = {
      schemaVersion: 1,
      items: [
        {
          id: 'weapon-an94',
          kind: 'weapon',
          displayName: 'AN-94',
          referenceSource: 'ref',
          dependencies: [],
          images: [{ path: validImgPathRel, sha256: 'f'.repeat(64), role: 'front' }],
          stage: 'reference-generated',
          model: null,
          runtime: null,
          verification: null,
          owner: 'Astra',
          nextAction: 'act'
        }
      ]
    };
    const resBadHash = validateCatalog(badHashManifest, { root: tmpDir });
    assert(resBadHash.valid === false, 'Image with sha256 mismatch fails validation');
    assert(resBadHash.errors.some(e => e.includes('sha256 mismatch')), 'Error explicitly identifies sha256 mismatch');

    // TEST 6: Non-Image / Corrupt Magic Bytes Detection
    const corruptMagicManifest = {
      schemaVersion: 1,
      items: [
        {
          id: 'weapon-an94',
          kind: 'weapon',
          displayName: 'AN-94',
          referenceSource: 'ref',
          dependencies: [],
          images: [{ path: corruptImgRel, sha256: corruptImgSha, role: 'front' }],
          stage: 'reference-generated',
          model: null,
          runtime: null,
          verification: null,
          owner: 'Astra',
          nextAction: 'act'
        }
      ]
    };
    const resCorruptMagic = validateCatalog(corruptMagicManifest, { root: tmpDir });
    assert(resCorruptMagic.valid === false, 'Non-image file fails magic bytes check despite matching hash');
    assert(resCorruptMagic.errors.some(e => e.includes('invalid magic bytes')), 'Error identifies invalid magic bytes');

    // TEST 7: Zero Byte Image Detection
    const zeroByteManifest = {
      schemaVersion: 1,
      items: [
        {
          id: 'weapon-an94',
          kind: 'weapon',
          displayName: 'AN-94',
          referenceSource: 'ref',
          dependencies: [],
          images: [{ path: emptyImgRel, sha256: calculateSha256(Buffer.alloc(0)), role: 'front' }],
          stage: 'reference-generated',
          model: null,
          runtime: null,
          verification: null,
          owner: 'Astra',
          nextAction: 'act'
        }
      ]
    };
    const resZeroByte = validateCatalog(zeroByteManifest, { root: tmpDir });
    assert(resZeroByte.valid === false, 'Zero-byte image file fails validation');
    assert(resZeroByte.errors.some(e => e.includes('0 bytes')), 'Error identifies 0-byte file');

    // TEST 8: Graph DAG & Duplicate IDs
    console.log('\n[Group 5: Graph Invariants & Dependencies]');
    const duplicateIdManifest = {
      items: [
        { id: 'dup-id', kind: 'weapon', displayName: 'D1', referenceSource: 'r', dependencies: [], images: [], stage: 'queued', model: null, runtime: null, verification: null, owner: 'Astra', nextAction: 'a' },
        { id: 'dup-id', kind: 'weapon', displayName: 'D2', referenceSource: 'r', dependencies: [], images: [], stage: 'queued', model: null, runtime: null, verification: null, owner: 'Astra', nextAction: 'a' }
      ]
    };
    const resDup = validateCatalog(duplicateIdManifest);
    assert(resDup.valid === false, 'Duplicate row id fails validation');
    assert(resDup.errors.some(e => e.includes('duplicate id')), 'Error identifies duplicate id');

    const cycleManifest = {
      items: [
        { id: 'row-a', kind: 'weapon', displayName: 'A', referenceSource: 'r', dependencies: ['row-b'], images: [], stage: 'queued', model: null, runtime: null, verification: null, owner: 'Astra', nextAction: 'a' },
        { id: 'row-b', kind: 'weapon', displayName: 'B', referenceSource: 'r', dependencies: ['row-a'], images: [], stage: 'queued', model: null, runtime: null, verification: null, owner: 'Astra', nextAction: 'a' }
      ]
    };
    const resCycle = validateCatalog(cycleManifest);
    assert(resCycle.valid === false, 'Dependency cycle fails validation');
    assert(resCycle.errors.some(e => e.includes('Cycle detected')), 'Error details circular dependency path');

    const unknownDepManifest = {
      items: [
        { id: 'row-a', kind: 'weapon', displayName: 'A', referenceSource: 'r', dependencies: ['non-existent'], images: [], stage: 'queued', model: null, runtime: null, verification: null, owner: 'Astra', nextAction: 'a' }
      ]
    };
    const resUnknownDep = validateCatalog(unknownDepManifest);
    assert(resUnknownDep.valid === false, 'Unknown dependency reference fails validation');
    assert(resUnknownDep.errors.some(e => e.includes('unknown dependency')), 'Error flags unknown dependency');

    // TEST 9: Stage Invariants & Image-Only Runtime Rejection
    console.log('\n[Group 6: Stage Evidence & Runtime Binding]');
    const imageAsRuntimeManifest = {
      items: [
        {
          id: 'weapon-an94',
          kind: 'weapon',
          displayName: 'AN-94',
          referenceSource: 'ref',
          dependencies: [],
          images: [{ path: validImgPathRel, sha256: VALID_1X1_PNG_SHA, role: 'front' }],
          stage: 'integrated',
          model: { path: validModelRel, sha256: validModelSha, triangles: 1200, materials: 1, decodedTextureBytes: 4096 },
          runtime: { entrypoint: validImgPathRel, assetPath: validImgPathRel, sourceCommit: 'commit123' },
          verification: null,
          owner: 'Astra',
          nextAction: 'act'
        }
      ]
    };
    const resImgRuntime = validateCatalog(imageAsRuntimeManifest, { root: tmpDir });
    assert(resImgRuntime.valid === false, 'Generated image claiming runtime entrypoint or asset is rejected');
    assert(resImgRuntime.errors.some(e => e.includes('cannot be an image file')), 'Error forbids image file as code entrypoint');

    const brokenEntryManifest = {
      items: [
        {
          id: 'weapon-an94',
          kind: 'weapon',
          displayName: 'AN-94',
          referenceSource: 'ref',
          dependencies: [],
          images: [],
          stage: 'integrated',
          model: { path: validModelRel, sha256: validModelSha, triangles: 1200, materials: 1, decodedTextureBytes: 4096 },
          runtime: { entrypoint: emptyEntryRel, assetPath: validAssetRel, sourceCommit: 'commit123' },
          verification: null,
          owner: 'Astra',
          nextAction: 'act'
        }
      ]
    };
    const resBrokenEntry = validateCatalog(brokenEntryManifest, { root: tmpDir });
    assert(resBrokenEntry.valid === false, 'Empty (0 byte) runtime entrypoint fails validation');
    assert(resBrokenEntry.errors.some(e => e.includes('empty (0 bytes)')), 'Error flags empty runtime entrypoint');

    // TEST 10: Receipt Integrity & Anti-Forgery Checks
    console.log('\n[Group 7: Verification Receipt Integrity]');
    // Subtest: receipt assetId mismatch
    const receiptAssetMismatchRel = 'docs/receipts/receipt-mismatch.json';
    fs.writeFileSync(path.join(tmpDir, receiptAssetMismatchRel), JSON.stringify({
      assetId: 'wrong-asset-id',
      buildHash: 'build-hash-nt-20260919-01',
      outcome: 'pass',
      sourcePath: validEntryRel
    }));
    const resAssetMismatch = validateCatalog({
      items: [{
        id: 'weapon-an94',
        kind: 'weapon',
        displayName: 'AN-94',
        referenceSource: 'ref',
        dependencies: [],
        images: [{ path: validImgPathRel, sha256: VALID_1X1_PNG_SHA, role: 'front' }],
        stage: 'verified',
        model: { path: validModelRel, sha256: validModelSha, triangles: 100, materials: 1, decodedTextureBytes: 100 },
        runtime: { entrypoint: validEntryRel, assetPath: validAssetRel, sourceCommit: 'c1' },
        verification: { receipt: receiptAssetMismatchRel, buildHash: 'build-hash-nt-20260919-01', visualApproved: true, runtimePassed: true },
        owner: 'Astra',
        nextAction: 'ship'
      }]
    }, { root: tmpDir });
    assert(resAssetMismatch.valid === false, 'Receipt assetId mismatch fails validation');
    assert(resAssetMismatch.errors.some(e => e.includes('receipt assetId mismatch')), 'Error catches assetId mismatch');

    // Subtest: receipt outcome != pass
    const receiptFailOutcomeRel = 'docs/receipts/receipt-fail-outcome.json';
    fs.writeFileSync(path.join(tmpDir, receiptFailOutcomeRel), JSON.stringify({
      assetId: 'weapon-an94',
      buildHash: 'build-hash-nt-20260919-01',
      outcome: 'fail',
      sourcePath: validEntryRel
    }));
    const resFailOutcome = validateCatalog({
      items: [{
        id: 'weapon-an94',
        kind: 'weapon',
        displayName: 'AN-94',
        referenceSource: 'ref',
        dependencies: [],
        images: [{ path: validImgPathRel, sha256: VALID_1X1_PNG_SHA, role: 'front' }],
        stage: 'verified',
        model: { path: validModelRel, sha256: validModelSha, triangles: 100, materials: 1, decodedTextureBytes: 100 },
        runtime: { entrypoint: validEntryRel, assetPath: validAssetRel, sourceCommit: 'c1' },
        verification: { receipt: receiptFailOutcomeRel, buildHash: 'build-hash-nt-20260919-01', visualApproved: true, runtimePassed: true },
        owner: 'Astra',
        nextAction: 'ship'
      }]
    }, { root: tmpDir });
    assert(resFailOutcome.valid === false, 'Receipt outcome "fail" is rejected');
    assert(resFailOutcome.errors.some(e => e.includes('receipt outcome is "fail"')), 'Error flags non-pass outcome');

    // Subtest: receipt sourcePath mismatch
    const receiptSourceMismatchRel = 'docs/receipts/receipt-source-mismatch.json';
    fs.writeFileSync(path.join(tmpDir, receiptSourceMismatchRel), JSON.stringify({
      assetId: 'weapon-an94',
      buildHash: 'build-hash-nt-20260919-01',
      outcome: 'pass',
      sourcePath: 'src/weapons/totally-different.ts'
    }));
    const resSourceMismatch = validateCatalog({
      items: [{
        id: 'weapon-an94',
        kind: 'weapon',
        displayName: 'AN-94',
        referenceSource: 'ref',
        dependencies: [],
        images: [{ path: validImgPathRel, sha256: VALID_1X1_PNG_SHA, role: 'front' }],
        stage: 'verified',
        model: { path: validModelRel, sha256: validModelSha, triangles: 100, materials: 1, decodedTextureBytes: 100 },
        runtime: { entrypoint: validEntryRel, assetPath: validAssetRel, sourceCommit: 'c1' },
        verification: { receipt: receiptSourceMismatchRel, buildHash: 'build-hash-nt-20260919-01', visualApproved: true, runtimePassed: true },
        owner: 'Astra',
        nextAction: 'ship'
      }]
    }, { root: tmpDir });
    assert(resSourceMismatch.valid === false, 'Receipt sourcePath mismatch is rejected');
    assert(resSourceMismatch.errors.some(e => e.includes('does not match runtime or model source path')), 'Error catches sourcePath mismatch');

    // Subtest: Unmet dependency disallows verified
    const unmetDepManifest = {
      items: [
        {
          id: 'anim-rig',
          kind: 'animation',
          displayName: 'Rig',
          referenceSource: 'ref',
          dependencies: [],
          images: [],
          stage: 'queued',
          model: null,
          runtime: null,
          verification: null,
          owner: 'Astra',
          nextAction: 'work'
        },
        {
          id: 'weapon-an94',
          kind: 'weapon',
          displayName: 'AN-94',
          referenceSource: 'ref',
          dependencies: ['anim-rig'],
          images: [{ path: validImgPathRel, sha256: VALID_1X1_PNG_SHA, role: 'front' }],
          stage: 'verified',
          model: { path: validModelRel, sha256: validModelSha, triangles: 100, materials: 1, decodedTextureBytes: 100 },
          runtime: { entrypoint: validEntryRel, assetPath: validAssetRel, sourceCommit: 'c1' },
          verification: { receipt: validReceiptRel, buildHash: 'build-hash-nt-20260919-01', visualApproved: true, runtimePassed: true },
          owner: 'Astra',
          nextAction: 'ship'
        }
      ]
    };
    const resUnmetDep = validateCatalog(unmetDepManifest, { root: tmpDir });
    assert(resUnmetDep.valid === false, 'Verified row with queued dependency fails validation');
    assert(resUnmetDep.errors.some(e => e.includes('dependencies must be verified first')), 'Error specifies dependency stage requirement');

    // TEST 11: Legitimate Verified Fixture (PASSES base and --require-runtime)
    console.log('\n[Group 8: Legitimate Verified Fixture & Mutation Testing]');
    const legitManifestData = {
      schemaVersion: 1,
      items: [
        {
          id: 'weapon-an94',
          kind: 'weapon',
          displayName: 'AN-94 Assault Rifle',
          referenceSource: 'BO2 clean render',
          dependencies: [],
          images: [{ path: validImgPathRel, sha256: VALID_1X1_PNG_SHA, role: 'front' }],
          stage: 'verified',
          model: {
            path: validModelRel,
            sha256: validModelSha,
            triangles: 2450,
            materials: 1,
            decodedTextureBytes: 524288
          },
          runtime: {
            entrypoint: validEntryRel,
            assetPath: validAssetRel,
            sourceCommit: '0138f85e151ea495f5bf2dfdba91c9aa134af1c3'
          },
          verification: {
            receipt: validReceiptRel,
            buildHash: 'build-hash-nt-20260919-01',
            visualApproved: true,
            runtimePassed: true
          },
          owner: 'Astra',
          nextAction: 'Candidate ready for root catalog merge'
        }
      ]
    };

    const legitManifestPath = path.join(tmpDir, 'legit-manifest.json');
    fs.writeFileSync(legitManifestPath, JSON.stringify(legitManifestData, null, 2));

    const resLegitBase = validateCatalog(legitManifestData, { root: tmpDir, requireRuntime: false });
    assert(resLegitBase.valid === true, 'Legitimate verified fixture passes base validation with 0 errors');
    assert(resLegitBase.passed === true, 'Legitimate verified fixture passes base gate');
    assert(resLegitBase.summary.verifiedCount === 1, 'Legitimate fixture counts 1 verified row');
    assert(resLegitBase.summary.openBacklogCount === 0, 'Legitimate fixture has 0 open backlog rows');

    const resLegitRuntime = validateCatalog(legitManifestData, { root: tmpDir, requireRuntime: true });
    assert(resLegitRuntime.passed === true, 'Legitimate verified fixture PASSES --require-runtime');

    // TEST 12: Mutation of Legitimate Fixture
    console.log('\n[Group 9: Mutation of Legitimate Fixture]');
    // Mutation A: Corrupt model SHA
    const mutModelSha = JSON.parse(JSON.stringify(legitManifestData));
    mutModelSha.items[0].model.sha256 = 'e'.repeat(64);
    assert(validateCatalog(mutModelSha, { root: tmpDir }).valid === false, 'Mutation A: Corrupt model SHA fails');

    // Mutation B: visualApproved = false
    const mutVisual = JSON.parse(JSON.stringify(legitManifestData));
    mutVisual.items[0].verification.visualApproved = false;
    assert(validateCatalog(mutVisual, { root: tmpDir }).valid === false, 'Mutation B: visualApproved=false fails');

    // Mutation C: runtimePassed = false
    const mutRuntimePassed = JSON.parse(JSON.stringify(legitManifestData));
    mutRuntimePassed.items[0].verification.runtimePassed = false;
    assert(validateCatalog(mutRuntimePassed, { root: tmpDir }).valid === false, 'Mutation C: runtimePassed=false fails');

    // Mutation D: Nonexistent receipt path
    const mutReceiptPath = JSON.parse(JSON.stringify(legitManifestData));
    mutReceiptPath.items[0].verification.receipt = 'docs/receipts/ghost.json';
    assert(validateCatalog(mutReceiptPath, { root: tmpDir }).valid === false, 'Mutation D: Nonexistent receipt path fails');

    // TEST 13: CLI execution integration test
    console.log('\n[Group 10: CLI Process & Report Integration]');
    const cliReportPath = path.join(tmpDir, 'test-report.md');
    const cliSuccess = runCLI([
      '--manifest', legitManifestPath,
      '--root', tmpDir,
      '--report', cliReportPath,
      '--require-runtime'
    ]);
    assert(cliSuccess.status === 0, 'CLI exit status is 0 for valid verified manifest with --require-runtime');
    assert(fs.existsSync(cliReportPath), 'CLI generated report markdown at specified path');

    const reportContent = fs.readFileSync(cliReportPath, 'utf8');
    assert(reportContent.includes('Standalone Nuketown 2025'), 'Report includes proper header');
    assert(reportContent.includes('PASS'), 'Report records PASS status');
    assert(reportContent.includes('Validators do NOT prove art quality'), 'Report records mandatory art quality disclaimer');

    const cliJsonReportPath = path.join(tmpDir, 'test-report.json');
    const cliJsonReport = runCLI([
      '--manifest', legitManifestPath,
      '--root', tmpDir,
      '--report', cliJsonReportPath,
      '--require-runtime'
    ]);
    assert(cliJsonReport.status === 0, 'CLI exit status is 0 when writing a JSON report');
    const parsedJsonReport = JSON.parse(fs.readFileSync(cliJsonReportPath, 'utf8'));
    assert(parsedJsonReport.reportType === 'nuketown-production-catalog-gate', 'JSON report has the stable report type');
    assert(parsedJsonReport.counts.totalRows === 1, 'JSON report preserves stage/count data');
    assert(parsedJsonReport.runtimeVerified.count === 1, 'JSON report records runtime verified count');
    assert(Array.isArray(parsedJsonReport.errors) && Array.isArray(parsedJsonReport.gateErrors), 'JSON report exposes machine-readable error arrays');

    const queuedFixturePath = path.join(tmpDir, 'queued-fixture.json');
    fs.writeFileSync(queuedFixturePath, JSON.stringify(queuedManifest, null, 2));
    const cliQueuedFail = runCLI([
      '--manifest', queuedFixturePath,
      '--root', tmpDir,
      '--require-runtime'
    ]);
    assert(cliQueuedFail.status === 1, 'CLI exit status is 1 for queued backlog manifest under --require-runtime');

    console.log(`\nAll ${testsPassed} assertions passed successfully!`);
  } finally {
    // Clean only own temporary directory
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      console.log(`Cleaned up temporary test directory: ${tmpDir}`);
    }
  }
}

try {
  runSuite();
  process.exit(0);
} catch (err) {
  console.error('\nSelf-test failed with error:', err.message);
  process.exit(1);
}
