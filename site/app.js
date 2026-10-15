/**
 * CloudDeploy Lite — Frontend Controller
 * Pure Vanilla JavaScript (No frameworks or external dependencies)
 */

(function () {
  'use strict';

  // State
  let currentMetadata = null;
  let activeStageId = 1;

  // Pipeline Stage Database for Interactive Inspector
  const pipelineStages = {
    1: {
      num: 'STAGE 01',
      title: 'Source Trigger & Checkout',
      desc: 'GitHub Actions triggers the deployment pipeline automatically on every push to the main branch or on manual execution via workflow_dispatch. It uses actions/checkout@v4 to pull the clean codebase.',
      filename: '.github/workflows/deploy.yml (Trigger & Checkout)',
      code: `on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  id-token: write   # Required for AWS OIDC authentication
  contents: read    # Required to check out repository code

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4`
    },
    2: {
      num: 'STAGE 02',
      title: 'Pre-Flight Integrity & Metadata Generation',
      desc: 'Before touching AWS infrastructure, a bash validation step asserts that site/index.html, styles.css, app.js, and version.json are intact and non-empty. It then stamps the current Git commit SHA and timestamp into site/version.json.',
      filename: '.github/workflows/deploy.yml (Pre-Flight Validation)',
      code: `- name: Validate site files exist
  run: |
    echo "==> Validating website bundle..."
    for file in site/index.html site/styles.css site/app.js site/version.json; do
      if [ ! -s "$file" ]; then
        echo "Error: Required file $file is missing or empty!" >&2
        exit 1
      fi
    done
    echo "All site files validated successfully."

- name: Stamp deployment metadata
  run: |
    COMMIT_SHA="\${{ github.sha }}"
    SHORT_SHA="\${COMMIT_SHA:0:7}"
    DEPLOY_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    
    python3 -c "
import json
with open('site/version.json', 'r+') as f:
    data = json.load(f)
    data['commitSha'] = '\$COMMIT_SHA'
    data['shortSha'] = '\$SHORT_SHA'
    data['deployedAt'] = '\$DEPLOY_TIME'
    data['deployedBy'] = 'GitHub Actions (run #\${{ github.run_number }})'
    f.seek(0)
    json.dump(data, f, indent=2)
    f.truncate()
" `
    },
    3: {
      num: 'STAGE 03',
      title: 'AWS IAM OIDC Federated Authentication',
      desc: 'Eliminates permanent AWS access keys. GitHub Actions requests a cryptographic JSON Web Token (JWT) from GitHub token issuer, which AWS STS verifies to assume the target IAM role for exactly 1 hour.',
      filename: '.github/workflows/deploy.yml (OIDC Authentication)',
      code: `- name: Configure AWS Credentials (OIDC)
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: \${{ vars.AWS_ROLE_ARN }}
    aws-region: \${{ vars.AWS_REGION }}
    audience: sts.amazonaws.com
    role-session-name: CloudDeployLite-\${{ github.run_id }}`
    },
    4: {
      num: 'STAGE 04',
      title: 'Atomic S3 Bucket Synchronization',
      desc: 'Syncs only the static bundle in site/ to the designated S3 bucket using the AWS CLI. The --delete flag guarantees that obsolete files are cleanly pruned, preventing stale assets from accumulating.',
      filename: '.github/workflows/deploy.yml (AWS S3 Sync)',
      code: `- name: Deploy static assets to AWS S3
  run: |
    echo "==> Synchronizing site/ to s3://\${{ vars.AWS_S3_BUCKET }}..."
    aws s3 sync site/ "s3://\${{ vars.AWS_S3_BUCKET }}" \\
      --delete \\
      --no-progress`
    },
    5: {
      num: 'STAGE 05',
      title: 'Post-Deployment Smoke Verification',
      desc: 'Performs automated HTTP health verification against the live S3 website endpoint. Probes return HTTP 200 and assert that version.json contains the newly deployed Git commit SHA. The pipeline fails immediately if unreachable.',
      filename: '.github/workflows/deploy.yml (Smoke Test)',
      code: `- name: Post-deployment HTTP Smoke Test
  run: |
    # 1. Probe website root
    HTTP_CODE=\$(curl -s -o /dev/null -w "%{http_code}" --retry 5 "$TARGET_URL")
    if [ "$HTTP_CODE" -ne 200 ]; then exit 1; fi

    # 2. Probe version.json and verify commit SHA
    VERSION_RESPONSE=\$(curl -s -f "$TARGET_URL/version.json")
    DEPLOYED_SHA=\$(echo "\$VERSION_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('commitSha', ''))")

    if [ "\$DEPLOYED_SHA" != "\${{ github.sha }}" ]; then
      echo "Commit SHA mismatch! Expected \${{ github.sha }}, got \$DEPLOYED_SHA" >&2
      exit 1
    fi
    echo "Smoke test passed with status 200 OK and matching commit SHA!"`
    }
  };

  // DOM Elements
  const elements = {
    metricStatusBadge: document.getElementById('metric-status-badge'),
    metricStatusVal: document.getElementById('metric-status-val'),
    smokeStatusText: document.getElementById('smoke-status-text'),
    metricVersionTag: document.getElementById('metric-version-tag'),
    metricShortSha: document.getElementById('metric-short-sha'),
    metricBranch: document.getElementById('metric-branch'),
    metricProvider: document.getElementById('metric-provider'),
    metricRegion: document.getElementById('metric-region'),
    metricEnvBadge: document.getElementById('metric-env-badge'),
    metricTimeAgo: document.getElementById('metric-time-ago'),
    metricDeployedBy: document.getElementById('metric-deployed-by'),
    btnCopySha: document.getElementById('btn-copy-sha'),
    btnRefresh: document.getElementById('btn-refresh'),
    btnRunSmokeNav: document.getElementById('btn-run-smoke-nav'),
    btnRunSmokeTerminal: document.getElementById('btn-run-smoke-terminal'),
    btnCopyJson: document.getElementById('btn-copy-json'),
    jsonMetadataDisplay: document.getElementById('json-metadata-display'),
    lastRefreshedTime: document.getElementById('last-refreshed-time'),
    smokeTerminalOutput: document.getElementById('smoke-terminal-output'),
    probeStatLatency: document.getElementById('probe-stat-latency'),
    probeStatHttp: document.getElementById('probe-stat-http'),
    probeStatPayload: document.getElementById('probe-stat-payload'),
    toastContainer: document.getElementById('toast-container'),
    stageDetailsBox: document.getElementById('stage-details-box'),
    detailsStageNum: document.getElementById('details-stage-num'),
    detailsStageTitle: document.getElementById('details-stage-title'),
    detailsStageDesc: document.getElementById('details-stage-desc'),
    detailsCodeFilename: document.getElementById('details-code-filename'),
    detailsStageCode: document.getElementById('details-stage-code'),
    btnCloseDetails: document.getElementById('btn-close-details'),
    btnCopyStageCode: document.getElementById('btn-copy-stage-code'),
    pipelineStepCards: document.querySelectorAll('.pipeline-step-card')
  };

  // Toast Notification Helper
  function showToast(message, type = 'info') {
    if (!elements.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <svg class="mini-icon text-cyan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 6L9 17l-5-5"/>
      </svg>
      <span>${escapeHtml(message)}</span>
    `;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'toastOut 200ms ease-in forwards';
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 200);
    }, 2500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  // Format relative time (e.g., "5 minutes ago")
  function formatRelativeTime(dateString) {
    if (!dateString) return 'Just now';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;

    const diffMs = Date.now() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    return `${diffDays}d ago`;
  }

  // Fetch deployment metadata
  async function loadMetadata() {
    try {
      const response = await fetch(`version.json?_t=${Date.now()}`);
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      const data = await response.json();
      currentMetadata = data;
      renderMetadata(data);
    } catch (err) {
      console.warn('Could not load version.json:', err);
      if (elements.jsonMetadataDisplay) {
        elements.jsonMetadataDisplay.textContent = '// Unable to fetch version.json. Running in static preview mode.';
      }
    }
  }

  // Render metadata to UI elements
  function renderMetadata(data) {
    if (elements.metricStatusVal) elements.metricStatusVal.textContent = data.status || 'Live & Synced';
    if (elements.metricVersionTag) elements.metricVersionTag.textContent = data.version ? `v${data.version}` : 'v1.0.0';
    if (elements.metricShortSha) elements.metricShortSha.textContent = data.shortSha || (data.commitSha ? data.commitSha.slice(0, 7) : 'e6a10f8');
    if (elements.metricBranch) elements.metricBranch.textContent = data.branch || 'main';
    if (elements.metricProvider) elements.metricProvider.textContent = data.hostingProvider || 'AWS S3';
    if (elements.metricRegion) elements.metricRegion.textContent = data.awsRegion || 'us-east-1';
    if (elements.metricEnvBadge) elements.metricEnvBadge.textContent = data.environment || 'Production';
    if (elements.metricDeployedBy) elements.metricDeployedBy.textContent = data.deployedBy || 'GitHub Actions (OIDC)';
    if (elements.smokeStatusText) elements.smokeStatusText.textContent = `${data.smokeTestStatus || 'Passed'} (200 OK)`;

    if (elements.metricTimeAgo) {
      elements.metricTimeAgo.textContent = formatRelativeTime(data.deployedAt);
      elements.metricTimeAgo.title = data.deployedAt ? new Date(data.deployedAt).toLocaleString() : '';
    }

    if (elements.jsonMetadataDisplay) {
      elements.jsonMetadataDisplay.textContent = JSON.stringify(data, null, 2);
    }

    if (elements.lastRefreshedTime) {
      elements.lastRefreshedTime.textContent = new Date().toLocaleTimeString();
    }
  }

  // Interactive Pipeline Stage Selection
  function selectPipelineStage(stageId) {
    activeStageId = stageId;
    const stage = pipelineStages[stageId];
    if (!stage) return;

    elements.pipelineStepCards.forEach((card) => {
      if (parseInt(card.getAttribute('data-stage'), 10) === stageId) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });

    if (elements.stageDetailsBox) {
      elements.stageDetailsBox.style.display = 'flex';
      if (elements.detailsStageNum) elements.detailsStageNum.textContent = stage.num;
      if (elements.detailsStageTitle) elements.detailsStageTitle.textContent = stage.title;
      if (elements.detailsStageDesc) elements.detailsStageDesc.innerHTML = stage.desc;
      if (elements.detailsCodeFilename) elements.detailsCodeFilename.textContent = stage.filename;
      if (elements.detailsStageCode) elements.detailsStageCode.textContent = stage.code;
    }
  }

  // Terminal logging helper
  function appendTerminalLine(text, styleClass = 'term-info') {
    if (!elements.smokeTerminalOutput) return;
    const line = document.createElement('div');
    line.className = `term-line ${styleClass}`;
    line.textContent = text;
    elements.smokeTerminalOutput.appendChild(line);
    elements.smokeTerminalOutput.scrollTop = elements.smokeTerminalOutput.scrollHeight;
  }

  // Smoke Test Simulation / Live Verification
  let isProbing = false;
  async function runSmokeTest() {
    if (isProbing) return;
    isProbing = true;

    // Reset UI stats
    if (elements.probeStatLatency) elements.probeStatLatency.textContent = 'Probing...';
    if (elements.probeStatHttp) elements.probeStatHttp.textContent = '...';
    if (elements.probeStatPayload) elements.probeStatPayload.textContent = 'Validating...';

    // Clear terminal and print header
    if (elements.smokeTerminalOutput) {
      elements.smokeTerminalOutput.innerHTML = '';
    }
    const timestamp = new Date().toISOString();
    appendTerminalLine(`[${timestamp}] Initiating automated HTTP smoke probe...`, 'term-dim');
    appendTerminalLine('> Target: GET ./version.json', 'term-info');
    appendTerminalLine('> Protocol: HTTP/1.1 over TLS / S3 Static Web', 'term-dim');

    const startTime = performance.now();

    try {
      const response = await fetch(`version.json?smoke_test=${Date.now()}`);
      const endTime = performance.now();
      const latency = Math.round(endTime - startTime);

      appendTerminalLine(`> Connection established. Response status: ${response.status} ${response.statusText}`, 'term-success');
      appendTerminalLine(`> Measured round-trip latency: ${latency} ms`, 'term-info');

      if (response.ok) {
        const payload = await response.json();
        appendTerminalLine(`> Response payload parsed: Valid JSON object`, 'term-success');
        
        // Assert required fields
        const requiredKeys = ['projectName', 'version', 'status', 'commitSha'];
        const missing = requiredKeys.filter((k) => !(k in payload));

        if (missing.length === 0) {
          appendTerminalLine(`> Payload schema validation: PASS (Verified keys: ${requiredKeys.join(', ')})`, 'term-success');
          appendTerminalLine(`> Active Git Commit SHA: ${payload.commitSha || 'unknown'}`, 'term-info');
          appendTerminalLine(`> Post-Deploy Health Check: ALL SYSTEMS OPERATIONAL (200 OK)`, 'term-success');

          if (elements.probeStatLatency) elements.probeStatLatency.textContent = `${latency} ms`;
          if (elements.probeStatHttp) elements.probeStatHttp.textContent = `${response.status} OK`;
          if (elements.probeStatPayload) elements.probeStatPayload.textContent = 'Valid (100%)';
          showToast(`Smoke test passed (${latency}ms) — 200 OK`, 'success');
        } else {
          appendTerminalLine(`> Warning: Missing metadata keys: ${missing.join(', ')}`, 'term-warn');
          if (elements.probeStatPayload) elements.probeStatPayload.textContent = 'Incomplete';
          showToast('Smoke test completed with schema warnings', 'warn');
        }
      } else {
        appendTerminalLine(`> Error: Endpoint returned non-200 code (${response.status})`, 'term-error');
        if (elements.probeStatHttp) elements.probeStatHttp.textContent = `${response.status} Error`;
        if (elements.probeStatPayload) elements.probeStatPayload.textContent = 'Failed';
        showToast(`Smoke test failed: HTTP ${response.status}`, 'error');
      }
    } catch (err) {
      const endTime = performance.now();
      const latency = Math.round(endTime - startTime);
      appendTerminalLine(`> Connection Error: ${err.message}`, 'term-error');
      appendTerminalLine('> Smoke probe could not establish socket connection to host', 'term-error');

      if (elements.probeStatLatency) elements.probeStatLatency.textContent = `${latency} ms`;
      if (elements.probeStatHttp) elements.probeStatHttp.textContent = 'ERR';
      if (elements.probeStatPayload) elements.probeStatPayload.textContent = 'Unreachable';
      showToast('Smoke test probe connection error', 'error');
    } finally {
      isProbing = false;
    }
  }

  // Copy to clipboard helper
  async function copyToClipboard(text, successMsg) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      showToast(successMsg, 'success');
    } catch (err) {
      console.error('Clipboard copy failed:', err);
      showToast('Could not copy to clipboard', 'warn');
    }
  }

  // Event Listeners Initialization
  function initEvents() {
    // Pipeline stage card click & keyboard selection
    elements.pipelineStepCards.forEach((card) => {
      card.addEventListener('click', () => {
        const stageId = parseInt(card.getAttribute('data-stage'), 10);
        selectPipelineStage(stageId);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const stageId = parseInt(card.getAttribute('data-stage'), 10);
          selectPipelineStage(stageId);
        }
      });
    });

    // Close stage details drawer
    if (elements.btnCloseDetails) {
      elements.btnCloseDetails.addEventListener('click', () => {
        if (elements.stageDetailsBox) {
          elements.stageDetailsBox.style.display = 'none';
        }
        elements.pipelineStepCards.forEach(c => c.classList.remove('active'));
      });
    }

    // Copy stage code snippet
    if (elements.btnCopyStageCode) {
      elements.btnCopyStageCode.addEventListener('click', () => {
        const codeText = elements.detailsStageCode ? elements.detailsStageCode.textContent : '';
        copyToClipboard(codeText, 'Workflow snippet copied to clipboard!');
      });
    }

    // Copy full Git commit SHA
    if (elements.btnCopySha) {
      elements.btnCopySha.addEventListener('click', () => {
        const sha = currentMetadata ? currentMetadata.commitSha : 'e6a10f82b7c419c8d3568c07e21a22be1b4f2c90';
        copyToClipboard(sha, `Commit SHA copied: ${sha.slice(0, 10)}...`);
      });
    }

    // Copy entire version.json
    if (elements.btnCopyJson) {
      elements.btnCopyJson.addEventListener('click', () => {
        const jsonText = currentMetadata ? JSON.stringify(currentMetadata, null, 2) : (elements.jsonMetadataDisplay ? elements.jsonMetadataDisplay.textContent : '{}');
        copyToClipboard(jsonText, 'Deployment metadata JSON copied!');
      });
    }

    // Refresh metadata button
    if (elements.btnRefresh) {
      elements.btnRefresh.addEventListener('click', () => {
        loadMetadata();
        showToast('Deployment metadata refreshed');
      });
    }

    // Smoke Test trigger buttons
    if (elements.btnRunSmokeNav) {
      elements.btnRunSmokeNav.addEventListener('click', runSmokeTest);
    }
    if (elements.btnRunSmokeTerminal) {
      elements.btnRunSmokeTerminal.addEventListener('click', runSmokeTest);
    }
  }

  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadMetadata();
    selectPipelineStage(1); // Set initial active stage to Stage 01
  });

})();
