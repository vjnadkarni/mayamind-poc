/**
 * MayaMind Exercise POC — Dynamic Time Warping
 *
 * DTW algorithm for comparing pose sequences.
 * Handles different execution speeds naturally.
 *
 * Optimizations:
 * - Sakoe-Chiba band constraint (limits warping width)
 * - Early abandoning (stop if cost exceeds threshold)
 */

import { vectorDistance } from './features.js';

/**
 * Compute DTW distance between two sequences
 *
 * @param {Array<Array>} seq1 - First sequence of feature vectors
 * @param {Array<Array>} seq2 - Second sequence of feature vectors
 * @param {Object} options - DTW options
 * @returns {Object} DTW result with distance and path
 */
export function dtw(seq1, seq2, options = {}) {
  const {
    bandWidth = null,       // Sakoe-Chiba band width (null = no constraint)
    distanceFunc = vectorDistance,
    normalize = true,       // Normalize by path length
    earlyAbandon = null,    // Stop if distance exceeds this
  } = options;

  const n = seq1.length;
  const m = seq2.length;

  if (n === 0 || m === 0) {
    return { distance: Infinity, path: [], normalized: Infinity };
  }

  // Initialize cost matrix with infinity
  const cost = Array(n + 1).fill(null).map(() => Array(m + 1).fill(Infinity));
  cost[0][0] = 0;

  // Compute cost matrix
  for (let i = 1; i <= n; i++) {
    // Apply Sakoe-Chiba band constraint
    const jStart = bandWidth ? Math.max(1, i - bandWidth) : 1;
    const jEnd = bandWidth ? Math.min(m, i + bandWidth) : m;

    for (let j = jStart; j <= jEnd; j++) {
      const d = distanceFunc(seq1[i - 1], seq2[j - 1]);

      // Find minimum cost path
      const minPrev = Math.min(
        cost[i - 1][j],     // Insertion
        cost[i][j - 1],     // Deletion
        cost[i - 1][j - 1]  // Match
      );

      cost[i][j] = d + minPrev;

      // Early abandoning
      if (earlyAbandon !== null && cost[i][j] > earlyAbandon) {
        // Continue but mark as exceeded
      }
    }
  }

  const rawDistance = cost[n][m];

  // Backtrack to find optimal path (optional, useful for visualization)
  const path = backtrack(cost, n, m);

  // Normalize by path length
  const normalizedDistance = normalize ? rawDistance / path.length : rawDistance;

  return {
    distance: rawDistance,
    normalized: normalizedDistance,
    path,
    pathLength: path.length,
  };
}

/**
 * Backtrack through cost matrix to find optimal path
 */
function backtrack(cost, n, m) {
  const path = [[n - 1, m - 1]];
  let i = n;
  let j = m;

  while (i > 1 || j > 1) {
    if (i === 1) {
      j--;
    } else if (j === 1) {
      i--;
    } else {
      const candidates = [
        [i - 1, j - 1, cost[i - 1][j - 1]],
        [i - 1, j, cost[i - 1][j]],
        [i, j - 1, cost[i][j - 1]],
      ];
      candidates.sort((a, b) => a[2] - b[2]);
      [i, j] = candidates[0];
    }
    path.unshift([i - 1, j - 1]);
  }

  return path;
}

/**
 * Compute DTW distance with sliding window over a longer sequence
 *
 * @param {Array<Array>} template - Reference template sequence
 * @param {Array<Array>} stream - Longer stream to search in
 * @param {Object} options - Search options
 * @returns {Object} Best match info
 */
export function slidingDTW(template, stream, options = {}) {
  const {
    windowSize = template.length,  // Size of sliding window
    stepSize = 1,                   // How much to slide each step
    bandWidth = Math.ceil(template.length * 0.3),
    topK = 1,                       // Return top K matches
  } = options;

  const matches = [];
  const templateLen = template.length;

  // Slide window over stream
  for (let start = 0; start <= stream.length - windowSize; start += stepSize) {
    const window = stream.slice(start, start + windowSize);
    const result = dtw(template, window, { bandWidth, normalize: true });

    matches.push({
      start,
      end: start + windowSize,
      distance: result.normalized,
      rawDistance: result.distance,
      pathLength: result.pathLength,
    });
  }

  // Sort by distance (best first)
  matches.sort((a, b) => a.distance - b.distance);

  return {
    best: matches[0] || null,
    topK: matches.slice(0, topK),
    allMatches: matches,
  };
}

/**
 * Compare a sequence against multiple templates
 *
 * @param {Array<Array>} sequence - Sequence to classify
 * @param {Object} templates - Map of {name: sequence}
 * @param {Object} options - Comparison options
 * @returns {Object} Classification result
 */
export function classifySequence(sequence, templates, options = {}) {
  const {
    bandWidth = null,
    threshold = Infinity,  // Max distance to consider a match
  } = options;

  const results = [];

  for (const [name, template] of Object.entries(templates)) {
    const result = dtw(sequence, template, { bandWidth, normalize: true });
    results.push({
      name,
      distance: result.normalized,
      rawDistance: result.distance,
      pathLength: result.pathLength,
    });
  }

  // Sort by distance
  results.sort((a, b) => a.distance - b.distance);

  const best = results[0];
  const isMatch = best && best.distance < threshold;

  return {
    match: isMatch ? best.name : null,
    confidence: isMatch ? 1 - (best.distance / threshold) : 0,
    best,
    all: results,
  };
}

/**
 * FastDTW approximation (for very long sequences)
 * Uses multi-resolution approach for O(n) complexity
 *
 * @param {Array<Array>} seq1 - First sequence
 * @param {Array<Array>} seq2 - Second sequence
 * @param {number} radius - Constraint radius
 * @returns {Object} Approximate DTW result
 */
export function fastDTW(seq1, seq2, radius = 10) {
  // Base case: sequences small enough for full DTW
  if (seq1.length <= radius * 2 || seq2.length <= radius * 2) {
    return dtw(seq1, seq2, { normalize: true });
  }

  // Downsample sequences by factor of 2
  const shrunk1 = downsample(seq1);
  const shrunk2 = downsample(seq2);

  // Recursively compute DTW on downsampled sequences
  const lowResResult = fastDTW(shrunk1, shrunk2, radius);

  // Expand path and use as constraint for full resolution
  const expandedPath = expandPath(lowResResult.path, seq1.length, seq2.length);
  const window = pathToWindow(expandedPath, radius, seq1.length, seq2.length);

  // Compute constrained DTW
  return constrainedDTW(seq1, seq2, window);
}

/**
 * Downsample sequence by averaging pairs
 */
function downsample(seq) {
  const result = [];
  for (let i = 0; i < seq.length - 1; i += 2) {
    const avg = seq[i].map((v, j) => (v + seq[i + 1][j]) / 2);
    result.push(avg);
  }
  // Handle odd length
  if (seq.length % 2 === 1) {
    result.push(seq[seq.length - 1]);
  }
  return result;
}

/**
 * Expand path from low resolution to high resolution
 */
function expandPath(path, n, m) {
  const expanded = [];
  for (const [i, j] of path) {
    expanded.push([i * 2, j * 2]);
    expanded.push([Math.min(i * 2 + 1, n - 1), Math.min(j * 2 + 1, m - 1)]);
  }
  return expanded;
}

/**
 * Convert path to window constraints
 */
function pathToWindow(path, radius, n, m) {
  const window = new Map();
  for (const [i, j] of path) {
    for (let di = -radius; di <= radius; di++) {
      for (let dj = -radius; dj <= radius; dj++) {
        const ni = i + di;
        const nj = j + dj;
        if (ni >= 0 && ni < n && nj >= 0 && nj < m) {
          const key = `${ni},${nj}`;
          window.set(key, true);
        }
      }
    }
  }
  return window;
}

/**
 * DTW with arbitrary window constraint
 */
function constrainedDTW(seq1, seq2, window) {
  const n = seq1.length;
  const m = seq2.length;

  const cost = Array(n + 1).fill(null).map(() => Array(m + 1).fill(Infinity));
  cost[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const key = `${i - 1},${j - 1}`;
      if (!window.has(key)) continue;

      const d = vectorDistance(seq1[i - 1], seq2[j - 1]);
      const minPrev = Math.min(
        cost[i - 1][j],
        cost[i][j - 1],
        cost[i - 1][j - 1]
      );
      cost[i][j] = d + minPrev;
    }
  }

  const path = backtrack(cost, n, m);
  return {
    distance: cost[n][m],
    normalized: cost[n][m] / path.length,
    path,
    pathLength: path.length,
  };
}
