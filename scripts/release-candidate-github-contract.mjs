const canonicalBranch = "main";
const requiredCheck = {
  appId: 15368,
  name: "Public Release Readiness",
};
const checkRunsPageSize = 100;
const maximumCheckRunPages = 100;

export function verifyCanonicalReleaseCandidate({
  candidateCommit,
  readGithubJson,
  repository,
}) {
  if (
    typeof candidateCommit !== "string" ||
    !/^[0-9a-f]+$/u.test(candidateCommit)
  ) {
    throw new Error(
      "Release candidate commit must be a lowercase hexadecimal Git object ID.",
    );
  }
  if (typeof repository !== "string" || repository.trim() === "") {
    throw new Error("Release candidate repository identity is required.");
  }
  if (typeof readGithubJson !== "function") {
    throw new Error("Release candidate GitHub reader is required.");
  }

  const branchEndpoint = `repos/${repository}/branches/${canonicalBranch}`;
  verifyCanonicalBranch({
    branchEndpoint,
    candidateCommit,
    readGithubJson,
  });

  const checkEndpoint =
    `repos/${repository}/commits/${encodeURIComponent(candidateCommit)}/check-runs?` +
    `check_name=${encodeURIComponent(requiredCheck.name)}&filter=latest&per_page=${checkRunsPageSize}`;
  const checkRuns = readStableCheckRuns({
    candidateCommit,
    checkEndpoint,
    readGithubJson,
  });

  const matchingChecks = checkRuns.filter(
    (check) =>
      isRecord(check) &&
      check.name === requiredCheck.name &&
      isRecord(check.app) &&
      check.app.id === requiredCheck.appId,
  );
  if (matchingChecks.length === 0) {
    throw new Error(
      `Release candidate ${candidateCommit} must have a latest ${requiredCheck.name} check run from GitHub Actions App ${requiredCheck.appId}.`,
    );
  }
  for (const matchingCheck of matchingChecks) {
    checkStartedAt(matchingCheck);
    checkId(matchingCheck);
    if (matchingCheck.head_sha !== candidateCommit) {
      throw new Error(
        `${requiredCheck.name} check run is bound to ${String(
          matchingCheck.head_sha ?? "unreadable",
        )}; expected release candidate ${candidateCommit}.`,
      );
    }
  }

  const check = matchingChecks.reduce((latest, candidate) =>
    compareCheckRecency(candidate, latest) > 0 ? candidate : latest,
  );
  if (check.status !== "completed" || check.conclusion !== "success") {
    throw new Error(
      `${requiredCheck.name} for release candidate ${candidateCommit} must be completed/success; received ${String(
        check.status ?? "unreadable",
      )}/${String(check.conclusion ?? "unreadable")}.`,
    );
  }

  verifyCanonicalBranch({
    branchEndpoint,
    candidateCommit,
    readGithubJson,
  });

  return {
    branch: canonicalBranch,
    checkRunId: check.id ?? null,
    commit: candidateCommit,
  };
}

function verifyCanonicalBranch({
  branchEndpoint,
  candidateCommit,
  readGithubJson,
}) {
  const branch = readGithubJson(
    branchEndpoint,
    `protected ${canonicalBranch} branch`,
  );
  if (!isRecord(branch) || branch.name !== canonicalBranch) {
    throw new Error(
      `GitHub did not return the canonical ${canonicalBranch} branch.`,
    );
  }
  if (branch.protected !== true) {
    throw new Error(
      `GitHub reports canonical ${canonicalBranch} as unprotected.`,
    );
  }
  if (!isRecord(branch.commit) || branch.commit.sha !== candidateCommit) {
    throw new Error(
      `Release candidate ${candidateCommit} must exactly equal protected ${canonicalBranch} commit ${String(
        branch.commit?.sha ?? "unreadable",
      )}.`,
    );
  }
}

function readStableCheckRuns({
  candidateCommit,
  checkEndpoint,
  readGithubJson,
}) {
  const firstPass = readCheckRunPages({
    candidateCommit,
    checkEndpoint,
    readGithubJson,
  });
  if (firstPass.pageCount === 1) {
    return firstPass.checkRuns;
  }

  const secondPass = readCheckRunPages({
    candidateCommit,
    checkEndpoint,
    readGithubJson,
  });
  if (
    stableProjection(firstPass.checkRuns) !==
    stableProjection(secondPass.checkRuns)
  ) {
    throw new Error(
      `${requiredCheck.name} check runs changed while GitHub pagination was being verified.`,
    );
  }
  return secondPass.checkRuns;
}

function readCheckRunPages({ candidateCommit, checkEndpoint, readGithubJson }) {
  const checkRuns = [];
  const seenIds = new Set();
  let expectedTotal = null;
  let expectedPageCount = null;

  for (let page = 1; page <= maximumCheckRunPages; page += 1) {
    const endpoint =
      page === 1 ? checkEndpoint : `${checkEndpoint}&page=${page}`;
    const response = readGithubJson(
      endpoint,
      `${requiredCheck.name} check runs page ${page} for ${candidateCommit}`,
    );
    if (!isRecord(response) || !Array.isArray(response.check_runs)) {
      throw new Error(
        `GitHub did not return check runs for release candidate ${candidateCommit}.`,
      );
    }
    if (
      !Number.isSafeInteger(response.total_count) ||
      response.total_count < 0
    ) {
      throw new Error(
        `GitHub returned an invalid total_count for ${requiredCheck.name} check runs.`,
      );
    }

    if (expectedTotal === null) {
      expectedTotal = response.total_count;
      expectedPageCount = Math.max(
        1,
        Math.ceil(expectedTotal / checkRunsPageSize),
      );
      if (expectedPageCount > maximumCheckRunPages) {
        throw new Error(
          `GitHub returned too many ${requiredCheck.name} check runs to verify safely.`,
        );
      }
    } else if (response.total_count !== expectedTotal) {
      throw new Error(
        `${requiredCheck.name} check run total_count changed during pagination.`,
      );
    }

    const expectedLength =
      page < expectedPageCount
        ? checkRunsPageSize
        : expectedTotal - checkRunsPageSize * (expectedPageCount - 1);
    if (response.check_runs.length !== expectedLength) {
      throw new Error(
        `${requiredCheck.name} check runs page ${page} contained ${response.check_runs.length} entries; expected ${expectedLength}.`,
      );
    }

    for (const checkRun of response.check_runs) {
      if (!isRecord(checkRun)) {
        throw new Error(
          `${requiredCheck.name} check runs contained an invalid entry.`,
        );
      }
      const id = checkId(checkRun);
      if (seenIds.has(id)) {
        throw new Error(
          `${requiredCheck.name} check run ID ${id} was repeated during pagination.`,
        );
      }
      seenIds.add(id);
      checkRuns.push(checkRun);
    }

    if (page === expectedPageCount) {
      break;
    }
  }

  if (expectedTotal === null || checkRuns.length !== expectedTotal) {
    throw new Error(
      `GitHub did not return the complete ${requiredCheck.name} check run set.`,
    );
  }
  return { checkRuns, pageCount: expectedPageCount };
}

function stableProjection(checkRuns) {
  return JSON.stringify(
    checkRuns.map((checkRun) => [
      checkRun.id,
      checkRun.name,
      isRecord(checkRun.app) ? checkRun.app.id : null,
      checkRun.head_sha,
      checkRun.started_at,
      checkRun.status,
      checkRun.conclusion,
    ]),
  );
}

function compareCheckRecency(left, right) {
  const leftStartedAt = checkStartedAt(left);
  const rightStartedAt = checkStartedAt(right);
  if (leftStartedAt !== rightStartedAt) {
    return leftStartedAt - rightStartedAt;
  }
  return checkId(left) - checkId(right);
}

function checkStartedAt(check) {
  const timestamp = Date.parse(check.started_at);
  if (!Number.isFinite(timestamp)) {
    throw new Error(
      `${requiredCheck.name} check run has an invalid started_at timestamp.`,
    );
  }
  return timestamp;
}

function checkId(check) {
  if (!Number.isSafeInteger(check.id) || check.id <= 0) {
    throw new Error(`${requiredCheck.name} check run has an invalid ID.`);
  }
  return check.id;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
