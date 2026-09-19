#!/usr/bin/env node
/**
 * scripts/catalog/catalog-gate.mjs
 *
 * Standalone Nuketown 2025 production-catalog gate.
 * Validates manifest JSON schema, relative contained paths, file integrity,
 * image magic bytes, dependency DAG acyclicity, stage evidence, and receipt matching.
 * Built-in Node only (no external dependencies).
 *
 * CLI:
 *   node scripts/catalog/catalog-gate.mjs --manifest <path> [--root <path>] [--report <path>] [--require-runtime] [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const VALID_KINDS = new Set(['weapon', 'killstreak', 'grenade', 'operator', 'animation', 'scenario']);
export const VALID_STAGES = new Set(['queued', 'reference-generated', 'authored', 'integrated', 'verified', 'rejected']);
export const CODE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs']);
export const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.exr', '.tga']);

/**
 * Checks magic bytes of a buffer for valid image formats.
 */
export function checkImageMagicBytes(buf) {
  if (!buf || buf.length === 0) {
    return { ok: false, error: 'File is zero bytes' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { ok: true, format: 'png' };
  }
  // JPEG: FF D8 FF
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return { ok: true, format: 'jpeg' };
  }
  // WEBP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { ok: true, format: 'webp' };
  }
  // GIF: GIF87a or GIF89a
  if (
    buf.length >= 6 &&
    (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')
  ) {
    return { ok: true, format: 'gif' };
  }
  return { ok: false, error: 'Unrecognized image magic bytes (expected PNG, JPEG, WEBP, or GIF)' };
}

/**
 * Calculates SHA256 of a buffer.
 */
export function calculateSha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').toLowerCase();
}

/**
 * Validates that a path is relative, normalized, and strictly contained within root.
 */
export function validateContainedPath(relPath, rootDir, fieldDesc) {
  const errors = [];
  if (typeof relPath !== 'string' || relPath.trim() === '') {
    errors.push(`${fieldDesc}: path must be a non-empty string`);
    return { ok: false, errors };
  }

  // Reject absolute paths across platforms (C:\..., /..., \\server\...)
  if (path.isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath) || relPath.startsWith('/') || relPath.startsWith('\\')) {
    errors.push(`${fieldDesc}: absolute path is forbidden ("${relPath}")`);
    return { ok: false, errors };
  }

  // Reject traversal segments (..)
  const normalized = path.normalize(relPath);
  const segments = normalized.split(/[\\/]/);
  if (segments.includes('..')) {
    errors.push(`${fieldDesc}: traversal segments ("..") are forbidden ("${relPath}")`);
    return { ok: false, errors };
  }

  if (rootDir) {
    const resolvedRoot = path.resolve(rootDir);
    const resolvedPath = path.resolve(resolvedRoot, relPath);
    if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
      errors.push(`${fieldDesc}: path resolves outside root directory ("${relPath}")`);
      return { ok: false, errors };
    }

    // Check symlink containment if file exists
    if (fs.existsSync(resolvedPath)) {
      try {
        const real = fs.realpathSync(resolvedPath);
        if (!real.startsWith(resolvedRoot + path.sep) && real !== resolvedRoot) {
          errors.push(`${fieldDesc}: symlink target escapes root directory ("${relPath}" -> "${real}")`);
          return { ok: false, errors };
        }
      } catch (err) {
        errors.push(`${fieldDesc}: failed to resolve realpath for "${relPath}": ${err.message}`);
        return { ok: false, errors };
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Detects dependency cycles using DFS (coloring algorithm).
 */
export function detectDependencyCycles(items) {
  const graph = new Map();
  for (const item of items) {
    if (item && typeof item.id === 'string') {
      graph.set(item.id, Array.isArray(item.dependencies) ? item.dependencies : []);
    }
  }

  const visited = new Map(); // 0: unvisited, 1: visiting, 2: visited
  const cycleMessages = [];

  function dfs(nodeId, stack) {
    visited.set(nodeId, 1);
    stack.push(nodeId);

    const deps = graph.get(nodeId) || [];
    for (const depId of deps) {
      if (!graph.has(depId)) {
        continue; // Handled separately as unknown dependency
      }
      const state = visited.get(depId) || 0;
      if (state === 1) {
        const idx = stack.indexOf(depId);
        const cycle = stack.slice(idx).concat(depId);
        cycleMessages.push(`Cycle detected: ${cycle.join(' -> ')}`);
      } else if (state === 0) {
        dfs(depId, stack);
      }
    }

    stack.pop();
    visited.set(nodeId, 2);
  }

  for (const id of graph.keys()) {
    if ((visited.get(id) || 0) === 0) {
      dfs(id, []);
    }
  }

  return cycleMessages;
}

/**
 * Validates a catalog manifest.
 */
export function validateCatalog(manifestData, options = {}) {
  const rootDir = options.root ? path.resolve(options.root) : null;
  const requireRuntime = Boolean(options.requireRuntime);

  const errors = [];
  const gateErrors = [];

  let items = null;
  if (Array.isArray(manifestData)) {
    items = manifestData;
  } else if (manifestData && typeof manifestData === 'object' && Array.isArray(manifestData.items)) {
    items = manifestData.items;
  } else if (manifestData && typeof manifestData === 'object' && Array.isArray(manifestData.catalog)) {
    items = manifestData.catalog;
  } else {
    errors.push('Manifest JSON root must be an array or an object with an "items" array.');
    return {
      valid: false,
      passed: false,
      summary: null,
      errors,
      gateErrors
    };
  }

  const itemsById = new Map();
  const duplicateIds = new Set();

  const summary = {
    totalRows: items.length,
    byStage: {
      queued: 0,
      'reference-generated': 0,
      authored: 0,
      integrated: 0,
      verified: 0,
      rejected: 0
    },
    byKind: {
      weapon: 0,
      killstreak: 0,
      grenade: 0,
      operator: 0,
      animation: 0,
      scenario: 0
    },
    openBacklogCount: 0,
    verifiedCount: 0,
    rejectedCount: 0
  };

  // First pass: basic field presence, id uniqueness, and tallying
  for (let idx = 0; idx < items.length; idx++) {
    const row = items[idx];
    const prefix = `Row [${idx}]`;

    if (!row || typeof row !== 'object') {
      errors.push(`${prefix}: entry must be an object.`);
      continue;
    }

    if (typeof row.id !== 'string' || row.id.trim() === '') {
      errors.push(`${prefix}: missing or empty "id".`);
    } else {
      if (itemsById.has(row.id)) {
        duplicateIds.add(row.id);
        errors.push(`${prefix}: duplicate id "${row.id}".`);
      } else {
        itemsById.set(row.id, row);
      }
    }

    if (!VALID_KINDS.has(row.kind)) {
      errors.push(`${prefix} (${row.id || 'unidentified'}): invalid kind "${row.kind}". Must be one of: ${[...VALID_KINDS].join(', ')}.`);
    } else {
      summary.byKind[row.kind] = (summary.byKind[row.kind] || 0) + 1;
    }

    if (typeof row.displayName !== 'string' || row.displayName.trim() === '') {
      errors.push(`${prefix} (${row.id || 'unidentified'}): missing or empty "displayName".`);
    }

    if (typeof row.referenceSource !== 'string' || row.referenceSource.trim() === '') {
      errors.push(`${prefix} (${row.id || 'unidentified'}): missing or empty "referenceSource".`);
    }

    if (!Array.isArray(row.dependencies)) {
      errors.push(`${prefix} (${row.id || 'unidentified'}): "dependencies" must be an array of string ids.`);
    }

    if (!Array.isArray(row.images)) {
      errors.push(`${prefix} (${row.id || 'unidentified'}): "images" must be an array of image descriptors.`);
    }

    if (!VALID_STAGES.has(row.stage)) {
      errors.push(`${prefix} (${row.id || 'unidentified'}): invalid stage "${row.stage}". Must be one of: ${[...VALID_STAGES].join(', ')}.`);
    } else {
      summary.byStage[row.stage] = (summary.byStage[row.stage] || 0) + 1;
      if (row.stage === 'verified') {
        summary.verifiedCount++;
      } else if (row.stage === 'rejected') {
        summary.rejectedCount++;
      } else {
        summary.openBacklogCount++;
      }
    }

    if (typeof row.owner !== 'string' || row.owner.trim() === '') {
      errors.push(`${prefix} (${row.id || 'unidentified'}): missing or empty "owner".`);
    }

    if (typeof row.nextAction !== 'string' || row.nextAction.trim() === '') {
      errors.push(`${prefix} (${row.id || 'unidentified'}): missing or empty "nextAction".`);
    }
  }

  // Second pass: dependency graph validation (existence + cycle detection)
  for (const [id, row] of itemsById.entries()) {
    if (Array.isArray(row.dependencies)) {
      for (const depId of row.dependencies) {
        if (typeof depId !== 'string') {
          errors.push(`Row "${id}": dependency must be a string id, got ${typeof depId}.`);
        } else if (!itemsById.has(depId)) {
          errors.push(`Row "${id}": references unknown dependency "${depId}".`);
        }
      }
    }
  }

  const cycles = detectDependencyCycles(items);
  for (const cycleMsg of cycles) {
    errors.push(`Dependency error: ${cycleMsg}`);
  }

  // Third pass: path containment, stage evidence, file inspection, and receipt verification
  for (let idx = 0; idx < items.length; idx++) {
    const row = items[idx];
    if (!row || typeof row !== 'object') continue;
    const rowId = row.id || `row_${idx}`;

    // Validate images
    const imagePaths = new Set();
    if (Array.isArray(row.images)) {
      for (let imgIdx = 0; imgIdx < row.images.length; imgIdx++) {
        const img = row.images[imgIdx];
        const imgDesc = `Row "${rowId}" image[${imgIdx}]`;
        if (!img || typeof img !== 'object') {
          errors.push(`${imgDesc}: entry must be an object with { path, sha256, role }.`);
          continue;
        }

        if (typeof img.role !== 'string' || img.role.trim() === '') {
          errors.push(`${imgDesc}: missing or empty "role".`);
        }

        if (typeof img.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(img.sha256)) {
          errors.push(`${imgDesc}: "sha256" must be a 64-character hex string.`);
        }

        const pathCheck = validateContainedPath(img.path, rootDir, `${imgDesc} path`);
        if (!pathCheck.ok) {
          errors.push(...pathCheck.errors);
        } else if (rootDir) {
          imagePaths.add(img.path);
          const resolvedImg = path.resolve(rootDir, img.path);
          if (!fs.existsSync(resolvedImg)) {
            errors.push(`${imgDesc}: image file does not exist at "${img.path}".`);
          } else {
            let buf;
            try {
              buf = fs.readFileSync(resolvedImg);
            } catch (err) {
              errors.push(`${imgDesc}: unable to read image file "${img.path}": ${err.message}`);
            }
            if (buf) {
              if (buf.length === 0) {
                errors.push(`${imgDesc}: image file "${img.path}" is 0 bytes.`);
              } else {
                const magicCheck = checkImageMagicBytes(buf);
                if (!magicCheck.ok) {
                  errors.push(`${imgDesc}: invalid magic bytes in "${img.path}": ${magicCheck.error}.`);
                }
                const actualSha = calculateSha256(buf);
                if (img.sha256 && actualSha !== img.sha256.toLowerCase()) {
                  errors.push(`${imgDesc}: sha256 mismatch for "${img.path}". Declared: ${img.sha256.toLowerCase()}, actual: ${actualSha}.`);
                }
              }
            }
          }
        }
      }
    }

    // Validate model
    if (row.model !== null && row.model !== undefined) {
      if (typeof row.model !== 'object') {
        errors.push(`Row "${rowId}": "model" must be null or an object.`);
      } else {
        const m = row.model;
        if (typeof m.triangles !== 'number' || m.triangles < 0 || !Number.isInteger(m.triangles)) {
          errors.push(`Row "${rowId}": model.triangles must be a non-negative integer.`);
        }
        if (typeof m.materials !== 'number' || m.materials < 0 || !Number.isInteger(m.materials)) {
          errors.push(`Row "${rowId}": model.materials must be a non-negative integer.`);
        }
        if (typeof m.decodedTextureBytes !== 'number' || m.decodedTextureBytes < 0 || !Number.isInteger(m.decodedTextureBytes)) {
          errors.push(`Row "${rowId}": model.decodedTextureBytes must be a non-negative integer.`);
        }
        if (typeof m.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(m.sha256)) {
          errors.push(`Row "${rowId}": model.sha256 must be a 64-character hex string.`);
        }

        const modelPathCheck = validateContainedPath(m.path, rootDir, `Row "${rowId}" model.path`);
        if (!modelPathCheck.ok) {
          errors.push(...modelPathCheck.errors);
        } else if (rootDir) {
          const resolvedModel = path.resolve(rootDir, m.path);
          if (!fs.existsSync(resolvedModel)) {
            errors.push(`Row "${rowId}": model file does not exist at "${m.path}".`);
          } else {
            try {
              const buf = fs.readFileSync(resolvedModel);
              const actualSha = calculateSha256(buf);
              if (m.sha256 && actualSha !== m.sha256.toLowerCase()) {
                errors.push(`Row "${rowId}": model sha256 mismatch for "${m.path}". Declared: ${m.sha256.toLowerCase()}, actual: ${actualSha}.`);
              }
            } catch (err) {
              errors.push(`Row "${rowId}": failed to read model file "${m.path}": ${err.message}`);
            }
          }
        }
      }
    }

    // Validate runtime
    if (row.runtime !== null && row.runtime !== undefined) {
      if (typeof row.runtime !== 'object') {
        errors.push(`Row "${rowId}": "runtime" must be null or an object.`);
      } else {
        const r = row.runtime;
        if (typeof r.sourceCommit !== 'string' || r.sourceCommit.trim() === '') {
          errors.push(`Row "${rowId}": runtime.sourceCommit must be a non-empty string.`);
        }

        // Rule: No generated-image row is allowed to count as runtime
        const entryExt = path.extname(r.entrypoint || '').toLowerCase();
        if (IMAGE_EXTENSIONS.has(entryExt)) {
          errors.push(`Row "${rowId}": runtime.entrypoint cannot be an image file ("${r.entrypoint}").`);
        }
        if (!CODE_EXTENSIONS.has(entryExt)) {
          errors.push(`Row "${rowId}": runtime.entrypoint must have a valid code extension (.ts, .js, .mjs, .cjs), got "${entryExt}".`);
        }

        const assetExt = path.extname(r.assetPath || '').toLowerCase();
        if (IMAGE_EXTENSIONS.has(assetExt)) {
          errors.push(`Row "${rowId}": runtime.assetPath cannot be an image file ("${r.assetPath}"). Generated images cannot count as runtime assets.`);
        }
        if (imagePaths.has(r.assetPath)) {
          errors.push(`Row "${rowId}": runtime.assetPath matches an image in images[]; generated images cannot substitute for runtime assets.`);
        }

        const entryCheck = validateContainedPath(r.entrypoint, rootDir, `Row "${rowId}" runtime.entrypoint`);
        if (!entryCheck.ok) {
          errors.push(...entryCheck.errors);
        } else if (rootDir) {
          const resolvedEntry = path.resolve(rootDir, r.entrypoint);
          if (!fs.existsSync(resolvedEntry)) {
            errors.push(`Row "${rowId}": runtime.entrypoint file does not exist at "${r.entrypoint}".`);
          } else {
            const stat = fs.statSync(resolvedEntry);
            if (stat.size === 0) {
              errors.push(`Row "${rowId}": runtime.entrypoint file "${r.entrypoint}" is empty (0 bytes).`);
            }
          }
        }

        const assetCheck = validateContainedPath(r.assetPath, rootDir, `Row "${rowId}" runtime.assetPath`);
        if (!assetCheck.ok) {
          errors.push(...assetCheck.errors);
        } else if (rootDir) {
          const resolvedAsset = path.resolve(rootDir, r.assetPath);
          if (!fs.existsSync(resolvedAsset)) {
            errors.push(`Row "${rowId}": runtime.assetPath file does not exist at "${r.assetPath}".`);
          }
        }
      }
    }

    // Validate verification object
    if (row.verification !== null && row.verification !== undefined) {
      if (typeof row.verification !== 'object') {
        errors.push(`Row "${rowId}": "verification" must be null or an object.`);
      } else {
        const v = row.verification;
        if (typeof v.buildHash !== 'string' || v.buildHash.trim() === '') {
          errors.push(`Row "${rowId}": verification.buildHash must be a non-empty string.`);
        }
        if (typeof v.visualApproved !== 'boolean') {
          errors.push(`Row "${rowId}": verification.visualApproved must be a boolean.`);
        }
        if (typeof v.runtimePassed !== 'boolean') {
          errors.push(`Row "${rowId}": verification.runtimePassed must be a boolean.`);
        }

        const receiptCheck = validateContainedPath(v.receipt, rootDir, `Row "${rowId}" verification.receipt`);
        if (!receiptCheck.ok) {
          errors.push(...receiptCheck.errors);
        } else if (rootDir) {
          const resolvedReceipt = path.resolve(rootDir, v.receipt);
          if (!fs.existsSync(resolvedReceipt)) {
            errors.push(`Row "${rowId}": verification receipt JSON file does not exist at "${v.receipt}".`);
          } else {
            let receiptJson = null;
            try {
              const raw = fs.readFileSync(resolvedReceipt, 'utf8');
              receiptJson = JSON.parse(raw);
            } catch (err) {
              errors.push(`Row "${rowId}": receipt at "${v.receipt}" is not valid JSON: ${err.message}`);
            }

            if (receiptJson && typeof receiptJson === 'object') {
              // Exact matches: assetId, buildHash, outcome pass, matching sourcePath
              if (receiptJson.assetId !== row.id) {
                errors.push(`Row "${rowId}": receipt assetId mismatch. Expected "${row.id}", got "${receiptJson.assetId}".`);
              }
              if (receiptJson.buildHash !== v.buildHash) {
                errors.push(`Row "${rowId}": receipt buildHash mismatch. Expected "${v.buildHash}", got "${receiptJson.buildHash}".`);
              }
              if (receiptJson.outcome !== 'pass') {
                errors.push(`Row "${rowId}": receipt outcome is "${receiptJson.outcome}" (required: "pass").`);
              }

              // Source path match: must match runtime.assetPath or runtime.entrypoint or model.path
              const validSourcePaths = new Set();
              if (row.runtime?.assetPath) validSourcePaths.add(row.runtime.assetPath);
              if (row.runtime?.entrypoint) validSourcePaths.add(row.runtime.entrypoint);
              if (row.model?.path) validSourcePaths.add(row.model.path);

              if (!receiptJson.sourcePath || !validSourcePaths.has(receiptJson.sourcePath)) {
                errors.push(`Row "${rowId}": receipt sourcePath "${receiptJson.sourcePath}" does not match runtime or model source path.`);
              }
            }
          }
        }
      }
    }

    // Stage-specific invariant checks
    if (row.stage === 'reference-generated') {
      if (!Array.isArray(row.images) || row.images.length === 0) {
        errors.push(`Row "${rowId}": stage "reference-generated" requires at least one entry in images[].`);
      }
    }

    if (row.stage === 'authored') {
      if (row.kind === 'weapon' || row.kind === 'killstreak' || row.kind === 'grenade' || row.kind === 'operator') {
        if (!row.model) {
          errors.push(`Row "${rowId}": stage "authored" for kind "${row.kind}" requires a non-null model.`);
        }
      }
    }

    if (row.stage === 'integrated') {
      if (row.kind === 'weapon' || row.kind === 'killstreak' || row.kind === 'grenade' || row.kind === 'operator') {
        if (!row.model) {
          errors.push(`Row "${rowId}": stage "integrated" for kind "${row.kind}" requires a non-null model.`);
        }
        if (!row.runtime) {
          errors.push(`Row "${rowId}": stage "integrated" for kind "${row.kind}" requires a non-null runtime.`);
        }
      }
    }

    if (row.stage === 'verified') {
      if (row.kind === 'weapon' || row.kind === 'killstreak' || row.kind === 'grenade' || row.kind === 'operator') {
        if (!row.model) {
          errors.push(`Row "${rowId}": stage "verified" for kind "${row.kind}" requires a non-null model.`);
        }
        if (!row.runtime) {
          errors.push(`Row "${rowId}": stage "verified" for kind "${row.kind}" requires a non-null runtime.`);
        }
      }

      if (!row.verification) {
        errors.push(`Row "${rowId}": stage "verified" requires a non-null verification block.`);
      } else {
        if (row.verification.visualApproved !== true) {
          errors.push(`Row "${rowId}": stage "verified" requires verification.visualApproved === true.`);
        }
        if (row.verification.runtimePassed !== true) {
          errors.push(`Row "${rowId}": stage "verified" requires verification.runtimePassed === true.`);
        }
      }

      // Check that all declared dependencies are also in 'verified' stage
      if (Array.isArray(row.dependencies)) {
        for (const depId of row.dependencies) {
          const depRow = itemsById.get(depId);
          if (depRow && depRow.stage !== 'verified') {
            errors.push(`Row "${rowId}": is marked "verified", but dependency "${depId}" is in stage "${depRow.stage}" (dependencies must be verified first).`);
          }
        }
      }
    }
  }

  // Runtime gate validation (--require-runtime)
  if (requireRuntime) {
    if (summary.verifiedCount === 0) {
      gateErrors.push('Runtime gate failed: no rows are in stage "verified".');
    }

    for (const [id, row] of itemsById.entries()) {
      if (row.stage !== 'rejected' && row.stage !== 'verified') {
        gateErrors.push(`Runtime gate failed: row "${id}" (${row.kind}) is in stage "${row.stage}" (required: "verified").`);
      }
    }
  }

  const valid = errors.length === 0;
  const passed = valid && gateErrors.length === 0;

  return {
    valid,
    passed,
    summary,
    errors,
    gateErrors,
    itemsById
  };
}

/**
 * Builds human-readable report markdown.
 */
export function generateReportText({ manifestPath, rootDir, requireRuntime, validationResult }) {
  const { summary, errors, gateErrors, itemsById } = validationResult;
  const passed = validationResult.passed;

  const lines = [];
  lines.push('# Standalone Nuketown 2025 — Production Catalog Completeness Report');
  lines.push('');
  lines.push(`- **Manifest File:** \`${manifestPath || 'synthetic-manifest'}\``);
  lines.push(`- **Asset Root:** \`${rootDir || 'unspecified (syntax & relative checks only)'}\``);
  lines.push(`- **Runtime Gate Enforced (--require-runtime):** \`${requireRuntime ? 'YES' : 'NO'}\``);
  lines.push(`- **Gate Status:** ${passed ? '✅ **PASS**' : '❌ **FAIL**'}`);
  lines.push('');
  lines.push('> [!NOTE]');
  lines.push('> Automated validation confirms contract completeness, structural invariants, hashes, and runtime receipts.');
  lines.push('> Validators do NOT prove art quality, aesthetic fidelity, or game feel.');
  lines.push('');

  if (summary) {
    lines.push('## Catalog Stage Summary');
    lines.push('');
    lines.push('| Stage | Count | Notes |');
    lines.push('|---|---|---|');
    lines.push(`| **Queued (Backlog)** | ${summary.byStage.queued} | Awaiting concept or capture |`);
    lines.push(`| **Reference Generated** | ${summary.byStage['reference-generated']} | Concept / multiview images captured & hashed |`);
    lines.push(`| **Authored** | ${summary.byStage.authored} | Mesh, texture & budget defined |`);
    lines.push(`| **Integrated** | ${summary.byStage.integrated} | Runtime entrypoint bound in engine |`);
    lines.push(`| **Verified** | ${summary.byStage.verified} | Visual signoff & runtime receipt confirmed |`);
    lines.push(`| **Rejected** | ${summary.byStage.rejected} | Deprecated or superseded |`);
    lines.push(`| **TOTAL ROWS** | **${summary.totalRows}** | |`);
    lines.push('');
    lines.push(`**Open Backlog Items:** **${summary.openBacklogCount}** remaining to be authored/integrated/verified.`);
    lines.push('Queued or reference-only rows are incomplete evidence; they are never counted as runtime-complete.');
    lines.push('');
    lines.push('### Breakdown by Kind');
    lines.push(`- **Weapon:** ${summary.byKind.weapon || 0}`);
    lines.push(`- **Killstreak:** ${summary.byKind.killstreak || 0}`);
    lines.push(`- **Grenade:** ${summary.byKind.grenade || 0}`);
    lines.push(`- **Operator:** ${summary.byKind.operator || 0}`);
    lines.push(`- **Animation:** ${summary.byKind.animation || 0}`);
    lines.push(`- **Scenario:** ${summary.byKind.scenario || 0}`);
    lines.push('');
  }

  if (errors.length > 0) {
    lines.push('## Validation Violations');
    lines.push('');
    for (const err of errors) {
      lines.push(`- ❌ ${err}`);
    }
    lines.push('');
  }

  if (gateErrors.length > 0) {
    lines.push('## Runtime Gate Failures');
    lines.push('');
    for (const gErr of gateErrors) {
      lines.push(`- 🚫 ${gErr}`);
    }
    lines.push('');
  }

  if (itemsById && itemsById.size > 0) {
    lines.push('## Catalog Inventory');
    lines.push('');
    lines.push('| ID | Kind | Stage | Owner | Next Action |');
    lines.push('|---|---|---|---|---|');
    for (const [id, item] of itemsById.entries()) {
      lines.push(`| \`${id}\` | ${item.kind} | \`${item.stage}\` | ${item.owner} | ${item.nextAction} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Builds the machine-readable report written when --report ends in .json.
 * Keep this separate from the CLI stdout shape so report files remain stable
 * and useful to the gallery/control-plane readers.
 */
export function generateReportData({ manifestPath, rootDir, requireRuntime, validationResult }) {
  const { summary, errors, gateErrors, itemsById } = validationResult;
  const openIds = itemsById
    ? [...itemsById.values()]
      .filter((item) => item.stage !== 'verified' && item.stage !== 'rejected')
      .map((item) => item.id)
    : [];
  return {
    schemaVersion: 1,
    reportType: 'nuketown-production-catalog-gate',
    generatedAt: new Date().toISOString(),
    manifestPath: manifestPath || null,
    rootDir: rootDir || null,
    requireRuntime,
    passed: validationResult.passed,
    valid: validationResult.valid,
    counts: summary ? {
      totalRows: summary.totalRows,
      openBacklogCount: summary.openBacklogCount,
      verifiedCount: summary.verifiedCount,
      rejectedCount: summary.rejectedCount,
      byStage: summary.byStage,
      byKind: summary.byKind
    } : null,
    stage: summary ? summary.byStage : null,
    errors,
    gateErrors,
    open: {
      count: openIds.length,
      ids: openIds
    },
    runtimeVerified: {
      count: summary ? summary.verifiedCount : 0,
      required: requireRuntime,
      passed: requireRuntime ? validationResult.passed : null
    }
  };
}

/**
 * CLI Entrypoint
 */
export function main(argv = process.argv) {
  let manifestArg = null;
  let rootArg = null;
  let reportArg = null;
  let requireRuntime = false;
  let outputJson = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--manifest' || arg === '-m') {
      manifestArg = argv[++i];
    } else if (arg.startsWith('--manifest=')) {
      manifestArg = arg.slice('--manifest='.length);
    } else if (arg === '--root' || arg === '-r') {
      rootArg = argv[++i];
    } else if (arg.startsWith('--root=')) {
      rootArg = arg.slice('--root='.length);
    } else if (arg === '--report') {
      reportArg = argv[++i];
    } else if (arg.startsWith('--report=')) {
      reportArg = arg.slice('--report='.length);
    } else if (arg === '--require-runtime') {
      requireRuntime = true;
    } else if (arg === '--json') {
      outputJson = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: node scripts/catalog/catalog-gate.mjs --manifest <path> [options]

Options:
  --manifest, -m <path>     Path to catalog manifest JSON (required)
  --root, -r <path>         Path to asset root directory (defaults to cwd)
  --report <path>           Path to write report (.md markdown, .json structured JSON)
  --require-runtime         Enforce that all active rows are verified
  --json                    Output structured result as JSON
  --help, -h                Show this help message
`);
      process.exit(0);
    } else {
      console.error(`Error: Unknown CLI argument "${arg}". Run with --help for usage.`);
      process.exit(1);
    }
  }

  if (!manifestArg) {
    console.error('Error: Missing required argument --manifest <path>.');
    process.exit(1);
  }

  const manifestPath = path.resolve(manifestArg);
  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: Manifest file does not exist at "${manifestPath}".`);
    process.exit(1);
  }

  let manifestData;
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    manifestData = JSON.parse(raw);
  } catch (err) {
    console.error(`Error: Failed to parse manifest JSON at "${manifestPath}": ${err.message}`);
    process.exit(1);
  }

  const rootDir = rootArg ? path.resolve(rootArg) : process.cwd();
  const validationResult = validateCatalog(manifestData, {
    root: rootDir,
    requireRuntime
  });

  const reportText = generateReportText({
    manifestPath,
    rootDir,
    requireRuntime,
    validationResult
  });

  if (reportArg) {
    const resolvedReportPath = path.resolve(reportArg);
    const parentDir = path.dirname(resolvedReportPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    const reportData = generateReportData({
      manifestPath,
      rootDir,
      requireRuntime,
      validationResult
    });
    const reportBody = path.extname(resolvedReportPath).toLowerCase() === '.json'
      ? `${JSON.stringify(reportData, null, 2)}\n`
      : reportText;
    const tempReportPath = `${resolvedReportPath}.tmp-${process.pid}`;
    fs.writeFileSync(tempReportPath, reportBody, 'utf8');
    fs.renameSync(tempReportPath, resolvedReportPath);
  }

  if (outputJson) {
    console.log(JSON.stringify({
      manifestPath,
      rootDir,
      requireRuntime,
      passed: validationResult.passed,
      valid: validationResult.valid,
      summary: validationResult.summary,
      errors: validationResult.errors,
      gateErrors: validationResult.gateErrors
    }, null, 2));
  } else {
    console.log(reportText);
  }

  process.exit(validationResult.passed ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv);
}
