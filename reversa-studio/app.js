const state = {
  project: null,
  library: null,
  dossier: null,
};

const textureSteps = [
  ['Dump Source', 'Review source capture path and ownership before preparing manifests.'],
  ['Texture Manifest', 'Require names, hashes, dimensions, and target package scope.'],
  ['Upscale Model', 'Keep model choice blocked until license and hash proof are present.'],
  ['Preview Compare', 'Record before/after evidence without mutating runtime files.'],
  ['Reinject Package', 'Proposal-only until rollback bundle exists.'],
  ['Rollback Bundle', 'Backups and hashes are mandatory before future apply work.'],
];

document.addEventListener('DOMContentLoaded', async () => {
  wireNavigation();
  wireAdvancedToggle();
  try {
    const [project, library, dossier] = await Promise.all([
      loadJson('fixtures/sample-project.json'),
      loadJson('fixtures/sample-model-library.json'),
      loadJson('fixtures/sample-patch-dossier.json'),
    ]);
    state.project = project;
    state.library = library;
    state.dossier = dossier;
    renderAll();
  } catch (error) {
    renderError(error);
  }
});

async function loadJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return response.json();
}

function wireNavigation() {
  document.querySelectorAll('[data-panel]').forEach(button => {
    button.addEventListener('click', () => {
      const target = button.dataset.panel;
      document.querySelectorAll('[data-panel]').forEach(item => item.classList.toggle('is-active', item === button));
      document.querySelectorAll('[data-panel-view]').forEach(panel => {
        panel.classList.toggle('is-active', panel.dataset.panelView === target);
      });
    });
  });
}

function wireAdvancedToggle() {
  const button = document.getElementById('advanced-toggle');
  button?.addEventListener('click', () => {
    const enabled = !document.body.classList.contains('show-advanced');
    document.body.classList.toggle('show-advanced', enabled);
    button.setAttribute('aria-pressed', String(enabled));
  });
}

function renderAll() {
  renderProject();
  renderEvidence();
  renderModels();
  renderTextureSteps();
  renderBackendMatrix();
  renderPatchDossier();
  renderSafetyGate();
}

function renderProject() {
  document.getElementById('project-name').textContent = state.project.activeProject.name;
  document.getElementById('project-next').textContent = state.project.activeProject.nextSafeAction;
  const cards = document.getElementById('project-cards');
  cards.innerHTML = state.project.cards.map(card => `
    <article class="card">
      ${chip(card.status)}
      <h3>${escapeHtml(card.title)}</h3>
      <p>${escapeHtml(card.description)}</p>
      <div class="count">${Number(card.count).toLocaleString()}</div>
    </article>
  `).join('');
}

function renderEvidence() {
  const board = state.project.evidenceBoard;
  document.getElementById('evidence-metrics').innerHTML = [
    metric('Total Records', board.totalRecords),
    metric('Generated Rows', board.generatedEvidenceRows),
    metric('Source-Backed Rows', board.sourceAuthorityRows),
  ].join('');
  document.getElementById('top-labels').innerHTML = board.topLabels.map(item => `
    <span class="label">${escapeHtml(item.label)} ${Number(item.count).toLocaleString()}</span>
  `).join('');
}

function renderModels() {
  const list = document.getElementById('model-list');
  list.innerHTML = state.library.models.map(model => `
    <article class="model">
      ${chip(model.licenseStatus === 'warning' ? 'Review' : 'Candidate')}
      <h3>${escapeHtml(model.id)}</h3>
      <p>${escapeHtml(model.source)}. License: ${escapeHtml(model.license)}. Hash status: ${escapeHtml(model.hashStatus)}.</p>
      <div class="model__meta">
        <span>Backend: ${escapeHtml(model.backend.join(', ') || 'unknown')}</span>
        <span>VRAM: ${escapeHtml(model.vramEstimate)}</span>
        <span>Acquisition: ${escapeHtml(model.acquisitionStatus)}</span>
      </div>
      <div class="advanced">
        source_authority=${String(model.source_authority)}
        generated_artifact=${String(model.generated_artifact)}
        labels=${escapeHtml(model.labels.join(', '))}
      </div>
    </article>
  `).join('');
}

function renderTextureSteps() {
  document.getElementById('texture-steps').innerHTML = textureSteps.map(([title, description], index) => `
    <article class="step">
      ${chip(index < 2 ? 'Review' : 'Blocked')}
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
    </article>
  `).join('');
}

function renderBackendMatrix() {
  const matrix = state.project.backendMatrix;
  document.getElementById('backend-matrix').innerHTML = [
    metric('CUDA', matrix.cuda),
    metric('Vulkan NCNN', matrix.vulkanNcnn),
    metric('ONNX', matrix.onnx),
    metric('TensorRT', matrix.tensorrt),
    metric('DirectML', matrix.directml),
    metric('Linux Candidate', matrix.linuxOrProtonUnproven),
  ].join('');
}

function renderPatchDossier() {
  document.getElementById('patch-banner').textContent = state.dossier.banner;
  document.getElementById('patch-checklist').innerHTML = state.dossier.checklist.map(item => `
    <div class="check-row">
      <span>${escapeHtml(item.item)}</span>
      ${chip(item.status === 'missing' ? 'Blocked' : 'Review')}
    </div>
  `).join('');
  document.getElementById('dossier-list').innerHTML = state.dossier.dossiers.map(dossier => `
    <article class="dossier">
      ${chip(dossier.status)}
      <h3>${escapeHtml(dossier.method)}</h3>
      <p>${escapeHtml(dossier.recommendedAction)}</p>
      <div class="dossier__meta">
        <span>Proof: ${escapeHtml(dossier.proofLevel)}</span>
        <span>Missing: ${escapeHtml(dossier.missingEvidence.join(', ') || 'none')}</span>
      </div>
      <div class="advanced">
        id=${escapeHtml(dossier.id)}
        labels=${escapeHtml(dossier.labels.join(', '))}
      </div>
    </article>
  `).join('');
}

function renderSafetyGate() {
  renderList('hard-blocks', state.project.safetyGate.hardBlocks, 'No hard blocks in this fixture.');
  renderList('soft-warnings', state.project.safetyGate.softWarnings, 'No soft warnings in this fixture.');
}

function renderList(id, items, emptyText) {
  const list = document.getElementById(id);
  const values = items.length > 0 ? items : [emptyText];
  list.innerHTML = values.map(item => `<li>${escapeHtml(item)}</li>`).join('');
}

function metric(label, value) {
  return `
    <article class="metric">
      <h3>${escapeHtml(label)}</h3>
      <strong>${Number(value || 0).toLocaleString()}</strong>
    </article>
  `;
}

function chip(status) {
  const normalized = String(status || 'Unknown').toLowerCase();
  const className = ['safe', 'review', 'blocked', 'candidate'].includes(normalized) ? normalized : 'unknown';
  return `<span class="chip ${className}">${escapeHtml(status)}</span>`;
}

function renderError(error) {
  document.getElementById('project-name').textContent = 'Fixture load failed';
  document.getElementById('project-next').textContent = error.message;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
