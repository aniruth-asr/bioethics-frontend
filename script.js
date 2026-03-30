/* BioEthics Radar — minimal frontend controller (monochrome UI)
   - Uses semantic backend when available
   - Falls back to deterministic local heuristic if backend is unreachable
*/

'use strict';

const BACKEND_URL = 'https://bioethics-radar.onrender.com';

const PILLARS = [
  { id: 'biosafety', name: 'Biosafety & Biosecurity', short: 'Biosafety', threshold: 50, frameworks: ['DURC/ASPR', 'Cartagena Protocol', 'BWC'] },
  { id: 'consent', name: 'Informed Consent & Welfare', short: 'Consent', threshold: 50, frameworks: ['Declaration of Helsinki', 'WHO AI Health Ethics'] },
  { id: 'environmental', name: 'Environmental Stewardship', short: 'Environment', threshold: 50, frameworks: ['Cartagena Protocol', 'BWC'] },
  { id: 'data', name: 'Data Privacy & Ethics', short: 'Data Privacy', threshold: 50, frameworks: ['WHO AI Health Ethics', 'Declaration of Helsinki'] },
  { id: 'justice', name: 'Justice & Research Equity', short: 'Justice', threshold: 50, frameworks: ['Declaration of Helsinki', 'WHO AI Health Ethics'] },
];

const $ = (id) => document.getElementById(id);

const state = {
  backendAvailable: null,
  lastPayload: null,
};

function setMeta(text) {
  const el = $('metaStatus');
  if (el) el.textContent = text;
}

function setOverlay(show, stageText) {
  const ov = $('overlay');
  if (!ov) return;
  ov.hidden = !show;
  if (stageText) $('overlayStage').textContent = stageText;
}

async function probeBackend() {
  if (state.backendAvailable !== null) return state.backendAvailable;
  try {
    const resp = await fetch(`https://bioethics-radar.onrender.com/health`, { method: 'GET' });
    state.backendAvailable = resp.ok;
    console.info(resp.ok ? '[BioEthics Radar] Semantic backend connected.' : '[BioEthics Radar] Semantic backend unreachable.');
  } catch (err) {
    state.backendAvailable = false;
    console.warn('[BioEthics Radar] Semantic backend unreachable.');
  }
  return state.backendAvailable;
}



function escapeHtml(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderResults(payload) {
  console.log("FULL PAYLOAD:", payload);
  window.debugPayload = payload;
  state.lastPayload = payload;

  const total = payload.total_score ?? 0;
  const status = payload.status ?? "FAIL";

  $('results').hidden = false;
  $('resultsSubtitle').textContent = `Overall ${total}/60 · ${status}`;

  const bars = $('bars');
  bars.innerHTML = '';

  // payload.results is an object keyed by pillar id (from _normaliseResult)
  // Normalise: if backend sent raw array, convert to object keyed by pillar id
  let resultsObj = payload.results;
  if (Array.isArray(resultsObj)) {
    const tmp = {};
    resultsObj.forEach((entry, i) => {
      const key = (entry.pillar || '').toLowerCase().trim();
      const idMap = {
        'biosafety & biosecurity': 'biosafety', 'biosafety': 'biosafety',
        'informed consent & welfare': 'consent', 'consent': 'consent',
        'environmental stewardship': 'environmental', 'environmental': 'environmental',
        'data privacy & ethics': 'data', 'data': 'data',
        'justice & research equity': 'justice', 'justice': 'justice',
      };
      const pid = idMap[key] || PILLARS[i]?.id;
      if (pid) tmp[pid] = entry;
    });
    resultsObj = tmp;
  }
  if (!resultsObj || typeof resultsObj !== 'object') {
    console.warn("No results found - showing fallback");
    bars.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">Analysis completed but no strong matches found</div>';
    return;
  }

  for (const p of PILLARS) {
    const r = resultsObj[p.id] || {
      score: 0,
      status: 'FAIL',
      findings: [{ type: 'warn', text: 'No result returned.' }],
      evidence: [],
      improvements: ['Re-run when backend is available.'],
    };

    const score = Math.max(0, Math.min(60, Math.round(Number(r.score) || 0)));
    const classification = r.classification || r.status || 'FAIL';

    console.log("RENDERING PILLAR:", p.name, "SCORE:", score);

    const el = document.createElement('div');
    el.className = 'bar';

    el.innerHTML = `
  <div class="bar-top">
    <div class="bar-label">${escapeHtml(p.name)}</div>
    <div class="bar-score">${score}/60</div>
  </div>

  <div class="bar-strip">
    <div class="bar-fill" style="width:0%"></div>
  </div>

  <details>
    <summary>Details</summary>
    <div class="detail">

      <div>
        <div class="block-title">Findings</div>
        <ul class="list">
          ${(r.findings || []).slice(0, 10)
        .map(f => `<li>${escapeHtml(typeof f === 'string' ? f : f.text)}</li>`)
        .join('') || '<li>No findings.</li>'}
        </ul>
      </div>

      <div>
        <div class="block-title">Evidence (verbatim)</div>
        ${(r.evidence || []).slice(0, 3).map(ev => {
          const quote = typeof ev === 'string' ? ev : (ev?.span || ev?.paper_span?.text || JSON.stringify(ev));
          return `
            <div class="evidence">
              <div class="evidence-quote">${escapeHtml(quote)}</div>
            </div>
          `;
        }).join('') || `
          <div class="evidence">
            <div class="evidence-quote">No grounded evidence span returned.</div>
          </div>
        `}
      </div>

      <div>
        <div class="block-title">Required Improvements</div>
        <ul class="list">
          ${(r.improvements || []).slice(0, 8)
        .map(x => `<li>${escapeHtml(String(x))}</li>`)
        .join('') || '<li>No improvements.</li>'}
        </ul>
      </div>

    </div>
  </details>
`;

    bars.appendChild(el);
    requestAnimationFrame(() => {
      const fill = el.querySelector('.bar-fill');
      if (fill) fill.style.width = `${(score / 60) * 100}%`;
    });
  }

  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function localFallback(text) {
  // Deterministic neutral-first heuristic to avoid false zero scores.
  const t = (text || '').toLowerCase();
  const scoreBase = () => 45;

  const signal = (re) => (re.test(t) ? 1 : 0);
  const biosafety = scoreBase()
    + 10 * signal(/\b(bsl[-\s]?[1-4]|biosafety level)\b/)
    + 8 * signal(/\b(ibc|institutional biosafety committee|durc|nsabb)\b/)
    - 35 * signal(/\bweaponiz|bioweapon|offensive biological\b/);
  const consent = scoreBase()
    + 10 * signal(/\b(irb|ethics committee)\b/)
    + 8 * signal(/\binformed consent\b/)
    - 25 * signal(/\bwithout\b.{0,20}\bconsent\b/);
  const environmental = scoreBase()
    + 8 * signal(/\b(environmental risk|risk assessment|cartagena)\b/)
    + 6 * signal(/\b(contained|containment|greenhouse)\b/)
    - 25 * signal(/\bopen[-\s]field release\b/);
  const data = scoreBase()
    + 10 * signal(/\b(de-identified|anonymized|pseudonymized)\b/)
    + 8 * signal(/\b(access control|gdpr|hipaa|encryption)\b/)
    - 25 * signal(/\bidentifiable\b.{0,40}\bwithout\b.{0,20}\bconsent\b/);
  const justice = scoreBase()
    + 8 * signal(/\b(benefit[-\s]sharing|equitable access|community engagement|lmic)\b/)
    - 15 * signal(/\bno\b.{0,25}\bbenefit[-\s]sharing\b/);

  const clamp = (x) => Math.max(0, Math.min(60, Math.round(x)));
  const per = [
    { pillar: PILLARS[0].id, score: clamp(biosafety) },
    { pillar: PILLARS[1].id, score: clamp(consent) },
    { pillar: PILLARS[2].id, score: clamp(environmental) },
    { pillar: PILLARS[3].id, score: clamp(data) },
    { pillar: PILLARS[4].id, score: clamp(justice) },
  ].map(r => ({
    ...r,
    status: 'FAIL',
    findings: ['Backend unreachable — using minimal local fallback (not guideline-grounded).'],
    evidence: [],
    improvements: ['Start the backend for guideline-grounded evidence and clause-linked improvements.'],
    engine_hint: 'fallback',
  }));

  const total = Math.round(per.reduce((a, x) => a + x.score, 0) / per.length);
  return { total_score: total, status: 'FAIL', results: per, engine: { model: 'fallback', stateless: true } };
}

async function analyzeText(text) {
  try {
    console.log("DEBUG: Sending request payload to POST /api/audit");
    const resp = await fetch(`http://127.0.0.1:10000/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    console.log("DEBUG: Response status:", resp.status);
    if (!resp.ok) {
      throw new Error(`Network error: ${resp.status}`);
    }

    const data = await resp.json();
    console.log("DEBUG: Parsed JSON:", data);

    if (typeof data.total_score !== 'number' || typeof data.status !== 'string' || !Array.isArray(data.results)) {
      throw new Error("Invalid format: Missing total_score, status, or results array in JSON.");
    }

    // Continue with existing normalisation
    const normalised = _normaliseResult(data);
    if (!normalised.results || typeof normalised.results !== 'object') throw new Error('Missing results');
    return normalised;
  } catch (err) {
    console.error("DEBUG: API Request Failed cleanly:", err);
    throw err;
  }
}

async function analyzeFile(file) {
  try {
    console.log("DEBUG: Sending request payload to POST /api/audit/file");
    const fd = new FormData();
    fd.append('file', file);

    const resp = await fetch(`http://127.0.0.1:10000/api/audit/file`, {
      method: 'POST',
      body: fd // Explicitly leaving Content-Type unset for boundary generation
    });

    console.log("DEBUG: Response status:", resp.status);
    if (!resp.ok) {
      throw new Error(`Network error: ${resp.status}`);
    }

    const data = await resp.json();
    console.log("DEBUG: Parsed JSON:", data);

    if (typeof data.total_score !== 'number' || typeof data.status !== 'string' || !Array.isArray(data.results)) {
      throw new Error("Invalid format: Missing total_score, status, or results array in JSON.");
    }

    const normalised = _normaliseResult(data);
    if (!normalised.results || typeof normalised.results !== 'object') throw new Error('Missing results');
    return normalised;
  } catch (err) {
    console.error("DEBUG: API Request Failed cleanly:", err);
    throw err;
  }
}

function wireInput() {
  const dz = $('dropZone');
  const fi = $('fileInput');
  const ta = $('paperText');
  const btn = $('analyzeBtn');

  const update = () => {
    const hasText = (ta.value || '').trim().length >= 80;
    btn.disabled = !hasText;
  };
  ta.addEventListener('input', update);
  update();

  $('clearBtn').addEventListener('click', () => {
    ta.value = '';
    $('results').hidden = true;
    update();
    setMeta('Ready');
  });

  $('sampleBtn').addEventListener('click', () => {
    ta.value = `Title: Vaccine platform safety evaluation\n\nAbstract: We evaluate an attenuated strain platform under BSL-2 containment with institutional oversight. Methods include biosafety protocols, IRB approval for human serology, and de-identified data governance.\n\nMethods: All pathogen handling occurred in certified facilities with IBC review and DURC screening. Human participants provided informed consent; withdrawal was supported. Data were pseudonymized and access-controlled.\n\nEthics & Compliance: Environmental risk was assessed for containment and waste handling. Community engagement and benefit-sharing agreements were established with partner institutions.\n`;
    update();
  });

  btn.addEventListener('click', async () => {
    const text = (ta.value || '').trim();
    if (text.length < 80) return;
    setOverlay(true, 'Submitting text…');
    setMeta('Analyzing…');
    try {
      const payload = await analyzeText(text);
      setOverlay(false);
      setMeta('Complete');
      console.log("DEBUG: Calling renderResults with UI update trigger...");
      renderResults(payload);
    } catch (e) {
      console.error("DEBUG: Render Error:", e);
      setOverlay(false);
      state.backendAvailable = false;
      setMeta('Error');
      $('results').hidden = false;
      $('resultsSubtitle').textContent = "Analysis Failed";
      $('bars').innerHTML = `<div style="padding: 20px; text-align: center; color: var(--c-warn);">Oops! Network or formatting issue: ${escapeHtml(e.message)}</div>`;
    }
  });

  // Drop zone
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', async (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    await handleFile(f);
  });
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fi.click(); });

  fi.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    await handleFile(f);
    fi.value = '';
  });

  async function handleFile(file) {
    setOverlay(true, `Uploading ${file.name}…`);
    setMeta('Analyzing…');
    try {
      const payload = await analyzeFile(file);
      setOverlay(false);
      setMeta('Complete');
      renderResults(payload);
    } catch (e) {
      console.error("DEBUG: File Render Error:", e);
      setOverlay(false);
      state.backendAvailable = false;
      setMeta('Error');
      $('results').hidden = false;
      $('resultsSubtitle').textContent = "Analysis Failed";
      $('bars').innerHTML = `<div style="padding: 20px; text-align: center; color: var(--c-warn);">Oops! File formatting issue: ${escapeHtml(e.message)}</div>`;
    }
  }

  $('newBtn').addEventListener('click', () => window.location.reload());
}

// Initialization logic moved to consolidated DOMContentLoaded handler at bottom of file

/* ═══════════════════════════════════════════════════════════════════
   BioEthics Radar v2.0 — Redesigned Script
   Per-Pillar Loaders · DNA Helix Loader · Mark List
   ═══════════════════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════════════════
// 1. DATA — VIRIDIS, REGULATORY CLAUSES (PILLARS declared at top)
// ═══════════════════════════════════════════════════════════════════

const VIRIDIS = ['#440154', '#3B528B', '#21908C', '#5DC963', '#FDE725'];

function scoreToViridis(score) {
  if (score >= 80) return VIRIDIS[4];
  if (score >= 60) return VIRIDIS[3];
  if (score >= 40) return VIRIDIS[2];
  if (score >= 20) return VIRIDIS[1];
  return VIRIDIS[0];
}

function scoreToRiskLabel(score) {
  if (score >= 80) return { label: 'Compliant', cls: 'ok' };
  if (score >= 60) return { label: 'Low Risk', cls: 'ok' };
  if (score >= 40) return { label: 'Moderate', cls: 'warn' };
  if (score >= 20) return { label: 'Elevated', cls: 'risk' };
  return { label: 'High Risk', cls: 'risk' };
}

// Pass/Fail/Warn verdict — score is raw 0–60 scale
// full paper / guidebook : >= 55
// pass                   : >= 35
// warn                   : >= 25
// fail                   : <  25
function scoreToVerdict(score, threshold) {
  if (score >= 35) return 'pass';
  if (score >= 25) return 'warn';
  return 'fail';
}

const REGULATORY_CLAUSES = {
  biosafety: [
    { source: 'DURC/ASPR · Section 3.1', text: 'Research that produces, aims to produce, or can be reasonably anticipated to produce one or more of the listed experimental effects must be evaluated for dual use research of concern (DURC) potential and requires Institutional Biosafety Committee (IBC) review.' },
    { source: 'Cartagena Protocol · Article 26', text: 'The Parties, in reaching a decision on import under this Protocol or under its domestic measures implementing the Protocol, may take into account, consistent with their international obligations, socio-economic considerations arising from the impact of living modified organisms on the conservation and sustainable use of biological diversity.' },
    { source: 'BWC · Article I', text: 'Each State Party to this Convention undertakes never in any circumstances to develop, produce, stockpile or otherwise acquire or retain: (1) Microbial or other biological agents, or toxins whatever their origin or method of production, of types and in quantities that have no justification for prophylactic, protective or other peaceful purposes.' },
  ],
  consent: [
    { source: 'Declaration of Helsinki · §25', text: 'Participation by individuals capable of giving informed consent as subjects in medical research must be voluntary. Although it may be appropriate to consult family members or community leaders, no individual capable of giving informed consent may be enrolled in a research study unless he or she freely agrees.' },
    { source: 'Declaration of Helsinki · §26', text: 'In medical research involving human subjects capable of giving informed consent, each potential subject must be adequately informed of the aims, methods, sources of funding, any possible conflicts of interest, institutional affiliations of the researcher, the anticipated benefits and potential risks of the study and the discomfort it may entail.' },
    { source: 'WHO AI Health Ethics · §4.3', text: 'AI technologies should not be used in ways that result in people being deceived or manipulated... Individuals should be able to exercise meaningful control over data collected about them, including the right to withdraw consent.' },
  ],
  environmental: [
    { source: 'Cartagena Protocol · Article 16', text: 'The Parties shall, taking into account Article 8 (g) of the Convention, establish and maintain appropriate mechanisms, measures and strategies to regulate, manage and control risks identified in the risk assessment provisions of this Protocol associated with the use, handling and transboundary movement of living modified organisms.' },
    { source: 'Cartagena Protocol · Article 15', text: 'Risk assessments undertaken pursuant to this Protocol shall be carried out in a scientifically sound manner, in accordance with Annex III and taking into account recognized risk assessment techniques. Such risk assessments shall be based, at a minimum, on information provided in accordance with Article 8 and other available scientific evidence.' },
  ],
  data: [
    { source: 'WHO AI Health Ethics · §5.1', text: 'The privacy and confidentiality of patient data must be protected, prioritizing data de-identification and enforcing strict access controls to prevent unauthorized profiling or disclosure.' },
    { source: 'Declaration of Helsinki · §24', text: 'Every precaution must be taken to protect the privacy of research subjects and the confidentiality of their personal information.' },
  ],
  justice: [
    { source: 'Declaration of Helsinki · §20', text: 'Medical research with a vulnerable group is only justified if the research is responsive to the health needs or priorities of this group and the research cannot be carried out in a non-vulnerable group. In addition, this group should stand to benefit from the knowledge, practices or interventions that result from the research.' },
    { source: 'WHO AI Health Ethics · §8.2', text: 'Designers and developers of AI technologies should ensure that AI systems do not exacerbate existing health inequalities. There should be equitable access to the benefits of AI technologies, and risks should not disproportionately fall upon vulnerable populations.' },
  ],
};

// ── Scoring rules ──────────────────────────────────────────────────
const SCORE_RULES = {
  biosafety: {
    positive: [
      { pattern: /BSL[-\s]?[1-4]/i, weight: 20, label: 'BSL level declared' },
      { pattern: /IBC approval|Institutional Biosafety/i, weight: 20, label: 'IBC oversight confirmed' },
      { pattern: /DURC review|dual[- ]use review/i, weight: 15, label: 'DURC review documented' },
      { pattern: /containment (protocol|measure|facility)/i, weight: 15, label: 'Containment measures described' },
      { pattern: /attenuated|inactivated|deactivated/i, weight: 15, label: 'Pathogen mitigation noted' },
      { pattern: /Select Agent |select agent program/i, weight: 10, label: 'Select Agent registration referenced' },
      { pattern: /biosafety (level|cabinet)|biosafety committee/i, weight: 5, label: 'Biosafety infrastructure noted' },
    ],
    negative: [
      { pattern: /gain[- ]of[- ]function|GOF research/i, deduct: 100, label: 'Critical: GOF research — elevated DURC concern' },
      { pattern: /\b(Ebola|Marburg|Variola|H5N1|weaponiz)/i, deduct: 100, label: 'Critical: High-consequence pathogen detected' },
      { pattern: /released into the environment|open[- ]field release/i, deduct: 100, label: 'Critical: Environmental release without containment' },
    ],
  },
  consent: {
    positive: [
      { pattern: /IRB approval|ethics committee approval/i, weight: 25, label: 'IRB approval documented' },
      { pattern: /informed consent/i, weight: 20, label: 'Informed consent referenced' },
      { pattern: /Helsinki|Declaration of Helsinki/i, weight: 15, label: 'Helsinki principles cited' },
      { pattern: /animal ethics|IACUC|3Rs|Replace.{0,30}Reduc|Refine/i, weight: 15, label: '3Rs / animal welfare principles applied' },
      { pattern: /voluntary (participation|enrolment)/i, weight: 10, label: 'Voluntary participation confirmed' },
      { pattern: /IRB-?\d{2,}/i, weight: 10, label: 'IRB reference number present' },
      { pattern: /participant welfare|subject welfare/i, weight: 5, label: 'Participant welfare addressed' },
    ],
    negative: [
      { pattern: /no IRB|without IRB|waiver of consent/i, deduct: 100, label: 'Critical: IRB waiver/absence noted' },
      { pattern: /retrospective (data|records)(?!.*consent)/i, deduct: 40, label: 'Retrospective data without consent mention' },
    ],
  },
  environmental: {
    positive: [
      { pattern: /environmental impact assessment|EIA/i, weight: 25, label: 'Environmental impact assessment cited' },
      { pattern: /ecological risk|biota|non-target organisms/i, weight: 20, label: 'Ecological risk addressed' },
      { pattern: /contained (facility|laboratory|greenhouse)/i, weight: 15, label: 'Contained environment confirmed' },
      { pattern: /Cartagena|living modified organism|LMO/i, weight: 15, label: 'Cartagena Protocol compliance noted' },
      { pattern: /biodiversity|ecosystem protection/i, weight: 15, label: 'Biodiversity concerns addressed' },
      { pattern: /waste disposal|biosafety discard/i, weight: 10, label: 'Waste management protocols mentioned' },
    ],
    negative: [
      { pattern: /open[- ]field (release|trial)(?!.*permit)/i, deduct: 100, label: 'Critical: Open-field release without permit reference' },
      { pattern: /uncontrolled (release|dispersal)/i, deduct: 100, label: 'Critical: Uncontrolled environmental dispersal risk' },
    ],
  },
  data: {
    positive: [
      { pattern: /de[- ]identified|anonymized|pseudonymized/i, weight: 25, label: 'Data de-identification stated' },
      { pattern: /data (governance|management|custodian)/i, weight: 20, label: 'Data governance framework referenced' },
      { pattern: /genomic (privacy|consent|data)/i, weight: 15, label: 'Genomic data privacy addressed' },
      { pattern: /GDPR|HIPAA|data protection regulation/i, weight: 15, label: 'Data protection regulation cited' },
      { pattern: /secure (storage|server|database|repository)/i, weight: 10, label: 'Secure data storage mentioned' },
      { pattern: /access control|role[- ]based access/i, weight: 10, label: 'Access control measures noted' },
      { pattern: /WHO AI|AI ethics/i, weight: 5, label: 'AI ethics guidelines referenced' },
    ],
    negative: [
      { pattern: /identifiable (patient|participant|subject) data(?!.*consent)/i, deduct: 100, label: 'Critical: Identifiable data used without clear consent' },
      { pattern: /public (upload|release) of.{0,20}(genomic|patient|personal)/i, deduct: 100, label: 'Critical: Unrestricted public release of sensitive data' },
    ],
  },
  justice: {
    positive: [
      { pattern: /benefit.{0,30}shar(ing)?|equitable access/i, weight: 25, label: 'Benefit-sharing / equitable access addressed' },
      { pattern: /WHO AI|Helsinki/i, weight: 20, label: 'Equity frameworks compliance referenced' },
      { pattern: /vulnerable (population|community|group)/i, weight: 15, label: 'Vulnerable populations considered' },
      { pattern: /low[- ]income|LMIC|developing (countr|world)/i, weight: 15, label: 'LMIC / global equity consideration noted' },
      { pattern: /community (engagement|consultation|governance)/i, weight: 15, label: 'Community engagement described' },
      { pattern: /capacity.{0,20}build|knowledge transfer/i, weight: 10, label: 'Capacity building / local partnership noted' },
    ],
    negative: [
      { pattern: /proprietary.{0,30}restrict(ed)? access/i, deduct: 40, label: 'Proprietary restriction on outputs' },
      { pattern: /benefit.{0,30}not address/i, deduct: 100, label: 'Critical: Benefit sharing not addressed' },
    ],
  },
};

function auditText(text) {
  const results = {};
  for (const pillar of PILLARS) {
    const rules = SCORE_RULES[pillar.id];
    let score = 0;
    const findings = [];
    let defensiveContext = false;
    let criticalFail = false;

    for (const rule of (rules.positive || [])) {
      if (rule.pattern.test(text)) {
        score += rule.weight;
        findings.push({ type: 'ok', text: rule.label });
        if (/BSL|IBC|vaccine|attenuated|containment/i.test(rule.label)) defensiveContext = true;
      }
    }
    for (const rule of (rules.negative || [])) {
      if (rule.pattern.test(text)) {
        score -= rule.deduct;
        findings.push({ type: 'risk', text: rule.label });
        if (rule.deduct >= 100) criticalFail = true;
      }
    }

    // Bounds Check
    score = Math.max(0, Math.min(100, Math.round(score)));

    // Fail Hard Logic: If it triggers an explicit framework violation or fails the minimum threshold, it strictly gives 0.
    if (criticalFail || score < pillar.threshold) {
      score = 0;
    }

    results[pillar.id] = { score, findings, defensiveContext, pillar };
  }
  return results;
}

// ── Token sets ────────────────────────────────────────────────────
const PATHOGEN_TOKENS = [
  'B. anthracis', 'Bacillus anthracis', 'anthrax', 'Y. pestis', 'Yersinia pestis', 'plague',
  'Variola', 'smallpox', 'Ebola', 'Marburg', 'Nipah', 'Hendra', 'H5N1', 'H7N9', 'HPAI',
  'Clostridium botulinum', 'botulinum toxin', 'Francisella tularensis', 'tularemia',
  'gain-of-function', 'GOF', 'SARS-CoV-2', 'MERS-CoV', 'prion', 'aerosolization',
];
const SAFETY_TOKENS = [
  'vaccine', 'vaccination', 'immunization', 'attenuation', 'attenuated',
  'BSL-1', 'BSL-2', 'BSL-3', 'BSL-4', 'biosafety level', 'biosafety cabinet',
  'containment', 'IBC approval', 'IRB approval', 'Ref: IRB',
  'prophylactic', 'therapeutic', 'deactivated', 'inactivated',
  'de-identified', 'de-identification', 'DURC review',
  'animal ethics', 'Helsinki', 'ethics committee', 'informed consent',
];

// ── Sample abstract ───────────────────────────────────────────────
const SAMPLE_ABSTRACT = `This study investigates the attenuated strain of Bacillus anthracis Sterne 34F2 as a platform for next-generation anthrax vaccine development under BSL-2 containment with enhanced biosafety protocols. All procedures were conducted in accordance with institutional biosafety committee (IBC) approval (Ref: IBC-2025-112) and DURC review guidelines (ASPR/NSABB). Animal models complied rigorously with the 3Rs framework. IRB approval was obtained (Ref: IRB-2025-089) and all human volunteer serology was conducted under full informed consent in accordance with the Declaration of Helsinki, Clause 26.

Genomic sequence data were de-identified prior to deposition and are governed by a restricted-access data management plan compliant with WHO AI Health Ethics guidelines §5.1. Environmental risk was assessed per Cartagena Protocol Article 15 standards; all modified organisms are maintained in a contained greenhouse facility with full waste disposal protocols.

Vaccine candidate material was developed under a Material Transfer Agreement (MTA) ensuring equitable benefit-sharing with partnering LMIC institutions. Community engagement processes were conducted in all three participating countries prior to study initiation, upholding the highest standards against the misuse of biological agents as set by the Biological Weapons Convention (BWC).`;

// ═══════════════════════════════════════════════════════════════════
// 2. STATE
// ═══════════════════════════════════════════════════════════════════
const STATE = {
  abstractText: '',
  auditResults: null,
  totalScore: 0,
  overallStatus: 'FAIL',
  evidenceSpans: [],
  v1Scores: null,
  activePillarId: null,
  bslValidated: false,
};
const LS_KEY = 'bioethics_radar_v1';

// ═══════════════════════════════════════════════════════════════════
// 3. DNA HELIX SVG BUILDER
// ═══════════════════════════════════════════════════════════════════

// Amino acid one-letter codes for labels
const AMINO_ACIDS = ['G', 'A', 'V', 'L', 'I', 'P', 'F', 'W', 'M', 'S', 'T', 'C', 'Y', 'H', 'D', 'E', 'N', 'Q', 'K', 'R'];

function buildMobiusStrip() {
  const svg = document.getElementById('dnaHelixSvg');
  if (!svg) return;

  const W = 300, H = 200;
  const pathData = 'M 150 100 C 200 30, 270 30, 270 100 C 270 170, 200 170, 150 100 C 100 30, 30 30, 30 100 C 30 170, 100 170, 150 100 Z';

  let svgContent = `
    <defs>
      <path id="mobiusTrack" d="${pathData}" />
      <linearGradient id="mobiusGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="var(--c-accent)" />
        <stop offset="50%" stop-color="var(--viridis-3)" />
        <stop offset="100%" stop-color="var(--c-accent)" />
      </linearGradient>
    </defs>
    <!-- Background glowing track -->
    <path d="${pathData}" fill="none" stroke="rgba(8,145,178,0.15)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
    <path d="${pathData}" fill="none" stroke="url(#mobiusGrad)" stroke-width="3" />
  `;

  // Add revolving amino acids along the path
  const numAcids = AMINO_ACIDS.length;
  for (let i = 0; i < numAcids; i++) {
    const delay = -(i * (7 / numAcids)).toFixed(2); // Spread them out over a 7s animation duration
    const color = i % 2 === 0 ? 'var(--viridis-3)' : 'var(--c-accent)';

    svgContent += `
      <g>
        <circle r="6" fill="${color}" fill-opacity="0.9" stroke="var(--c-bg)" stroke-width="1"/>
        <text y="1" font-family="'JetBrains Mono',monospace" font-size="5" fill="#0F172A" text-anchor="middle" dominant-baseline="middle" font-weight="700">${AMINO_ACIDS[i]}</text>
        <animateMotion dur="7s" repeatCount="indefinite" begin="${delay}s">
          <mpath href="#mobiusTrack"/>
        </animateMotion>
      </g>
    `;
  }

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = svgContent;
}

// ═══════════════════════════════════════════════════════════════════
// 4. PER-PILLAR LOADER ANIMATION
// ═══════════════════════════════════════════════════════════════════

const PILLAR_STAGES = [
  'Parsing specimen text…',
  'Scanning Biosafety & Biosecurity signals…',
  'Evaluating Informed Consent & Welfare…',
  'Assessing Environmental Stewardship…',
  'Auditing Data Privacy & Ethics…',
  'Analysing Justice & Research Equity…',
  'Compiling audit report…',
];

// Circumference of circle r=24: 2*PI*24 ≈ 150.796
const CIRC = 2 * Math.PI * 24;

function setPillarState(pillarId, state /* 'idle'|'running'|'done' */, score) {
  const spinRing = document.getElementById(`pls-${pillarId}`);
  const fillCirc = document.getElementById(`plc-${pillarId}`);
  const pct = document.getElementById(`plt-${pillarId}`);
  const statusBadge = document.getElementById(`pst-${pillarId}`);

  if (!spinRing || !fillCirc || !pct || !statusBadge) return;

  if (state === 'running') {
    spinRing.classList.add('active');
    statusBadge.textContent = 'Scanning…';
    statusBadge.className = 'pl-status running';
    fillCirc.style.stroke = 'var(--viridis-2)';
  } else if (state === 'done') {
    spinRing.classList.remove('active');
    const normalized = Math.max(0, Math.min(100, Math.round(score)));
    const color = scoreToViridis(normalized);
    const offset = CIRC - (normalized / 100) * CIRC;
    fillCirc.style.strokeDashoffset = offset;
    fillCirc.style.stroke = color;
    pct.textContent = `${normalized}%`;
    statusBadge.textContent = 'Done';
    statusBadge.className = 'pl-status done';
  } else {
    spinRing.classList.remove('active');
    fillCirc.style.strokeDashoffset = CIRC;
    pct.textContent = '—';
    statusBadge.textContent = 'Queued';
    statusBadge.className = 'pl-status idle';
  }
}

function resetAllPillarLoaders() {
  for (const p of PILLARS) setPillarState(p.id, 'idle', 0);
}

// Animate each pillar one by one with delay
async function animatePillarLoaders(results) {
  const stageEl = document.getElementById('dnaLoaderStage');
  if (stageEl) stageEl.textContent = PILLAR_STAGES[0];

  await sleep(400);
  for (let i = 0; i < PILLARS.length; i++) {
    const p = PILLARS[i];
    if (stageEl) stageEl.textContent = PILLAR_STAGES[i + 1];
    setPillarState(p.id, 'running', 0);
    await sleep(700);
    setPillarState(p.id, 'done', results[p.id].normalizedScore ?? results[p.id].score);
    await sleep(200);
  }
  if (stageEl) stageEl.textContent = PILLAR_STAGES[PILLARS.length + 1];
  await sleep(400);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════════
// 5. MARK LIST RENDERER
// ═══════════════════════════════════════════════════════════════════

const VERDICT_ICON = {
  pass: '✓',
  fail: '✗',
  warn: '~',
};

function renderMarkList(results) {
  const grid = document.getElementById('marklistGrid');
  const summaryEl = document.getElementById('marklistSummary');
  grid.innerHTML = '';

  console.log("[renderMarkList] Rendering with results:", results);

  let passCount = 0, failCount = 0, warnCount = 0;

  PILLARS.forEach((pillar, idx) => {
    const result = results[pillar.id];
    console.log(`[renderMarkList] Pillar ${pillar.id}:`, result);

    if (!result) {
      console.warn(`[renderMarkList] WARNING: No result for pillar ${pillar.id}`);
      return;
    }

    const verdict = scoreToVerdict((result.score || 0), pillar.threshold);
    const color = scoreToViridis(result.score);
    const topFind = result.findings && result.findings.length > 0
      ? (typeof result.findings[0] === 'string' ? result.findings[0] : result.findings[0]?.text || 'No signals detected')
      : 'No signals detected';

    if (verdict === 'pass') passCount++;
    else if (verdict === 'fail') failCount++;
    else warnCount++;

    const card = document.createElement('div');
    card.className = `marklist-card ${verdict}`;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${pillar.name}: ${result.score}%, ${verdict}`);
    card.style.animationDelay = `${idx * 0.08}s`;

    card.innerHTML = `
      <div class="ml-verdict-icon ${verdict}">${VERDICT_ICON[verdict]}</div>
      <div class="ml-pillar-name">${pillar.name}</div>
      <div class="ml-score" style="color:${color}">${result.score}/60</div>
      <span class="ml-verdict-label ${verdict}">${result.classification || result.status || (verdict === 'pass' ? 'PASS' : verdict === 'fail' ? 'FAIL' : 'OKAY')}</span>
      <div class="ml-top-finding">${topFind}</div>
    `;
    card.addEventListener('click', () => focusPillar(pillar.id));
    card.addEventListener('keydown', e => { if (e.key === 'Enter') focusPillar(pillar.id); });
    grid.appendChild(card);
  });

  // Summary chips
  summaryEl.innerHTML = `
    <span class="ml-summary-chip pass">✓ ${passCount} Pass</span>
    ${warnCount ? `<span class="ml-summary-chip" style="color:var(--c-warn);background:rgba(245,158,11,0.1);border-color:var(--c-warn)">~ ${warnCount} Review</span>` : ''}
    ${failCount ? `<span class="ml-summary-chip fail">✗ ${failCount} Fail</span>` : ''}
  `;
}

// ═══════════════════════════════════════════════════════════════════
// 6. FILE UPLOAD
// ═══════════════════════════════════════════════════════════════════

function setupUpload() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const textarea = document.getElementById('abstractTextarea');

  document.getElementById('browseBtn').addEventListener('click', e => { e.stopPropagation(); fileInput.click(); });
  fileInput.addEventListener('change', e => handleFile(e.target.files[0]));

  dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  textarea.addEventListener('input', () => {
    const val = textarea.value.trim();
    const isPlaceholder = val.startsWith('[Full PDF analysed server-side:');
    document.getElementById('auditBtn').disabled = val.length < 20 || isPlaceholder;
  });
  document.getElementById('auditBtn').addEventListener('click', () => {
    const val = textarea.value.trim();
    if (val.length >= 20 && !val.startsWith('[Full PDF analysed server-side:')) {
      runAudit(val);
    }
  });
  document.getElementById('clearBtn').addEventListener('click', () => {
    textarea.value = ''; document.getElementById('auditBtn').disabled = true;
  });
  document.getElementById('sampleBtn').addEventListener('click', () => {
    textarea.value = SAMPLE_ABSTRACT;
    document.getElementById('auditBtn').disabled = false;
  });

  document.getElementById('uploadV2Btn').addEventListener('click', () => document.getElementById('fileInputV2').click());
  document.getElementById('fileInputV2').addEventListener('change', e => handleFileV2(e.target.files[0]));

  document.getElementById('newAuditBtn').addEventListener('click', () => { window.location.reload(); });
}

function handleFile(file) {
  if (!file) return;
  if (file.name.toLowerCase().endsWith('.pdf')) {
    document.getElementById('abstractTextarea').value = '[Reading PDF — please wait…]';
    document.getElementById('auditBtn').disabled = true;
    runAuditFromFile(file);
  } else {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result.trim();
      document.getElementById('abstractTextarea').value = text;
      document.getElementById('auditBtn').disabled = text.length < 20;
      if (text.length >= 20) runAudit(text);
    };
    reader.readAsText(file);
  }
}

function handleFileV2(file) {
  if (!file) return;
  if (STATE.auditResults) {
    const v1 = {};
    for (const p of PILLARS) v1[p.id] = STATE.auditResults[p.id].score;
    localStorage.setItem(LS_KEY, JSON.stringify(v1));
    STATE.v1Scores = v1;
  }
  if (file.name.toLowerCase().endsWith('.pdf')) {
    runAuditFromFile(file, true);
  } else {
    const reader = new FileReader();
    reader.onload = e => runAudit(e.target.result.trim(), true);
    reader.readAsText(file);
  }
}

// ═══════════════════════════════════════════════════════════════════
// 7. SEMANTIC BACKEND BRIDGE
// ═══════════════════════════════════════════════════════════════════

/**
 * _normaliseResult — ensures every pillar result from the backend has the
 * correct shape that the UI rendering functions expect.
 */
function _normaliseResult(raw) {
  console.log("[_normaliseResult] Input raw:", raw);
  const out = {};
  const idOrder = ['biosafety', 'consent', 'environmental', 'data', 'justice'];

  // Map both full names AND short IDs so either format from the backend works
  const byNameMap = {
    'biosafety & biosecurity': 'biosafety',
    'informed consent & welfare': 'consent',
    'environmental stewardship': 'environmental',
    'data privacy & ethics': 'data',
    'justice & research equity': 'justice',
    'biosafety': 'biosafety',
    'consent': 'consent',
    'environmental': 'environmental',
    'data privacy': 'data',
    'data': 'data',
    'justice': 'justice',
    // extra aliases for any backend variation
    'biosafety & biosecurity ': 'biosafety',
    'informed consent & welfare ': 'consent',
    'environmental stewardship ': 'environmental',
    'data privacy & ethics ': 'data',
    'justice & research equity ': 'justice',
  };

  if (Array.isArray(raw.results)) {
    raw.results.forEach((entry, i) => {
      const pKey = (entry.pillar || '').toLowerCase().trim();
      const pid = byNameMap[pKey] || idOrder[i];
      console.log(`[_normaliseResult] Entry ${i}: pillar key="${pKey}", mapped to pid="${pid}"`);
      if (!pid) {
        console.warn(`[_normaliseResult] Skipping entry ${i}: could not map pillar "${entry.pillar}"`);
        return;
      }

      const score = Math.max(0, Math.min(60, Number(entry.score) || 0));
      console.log(`[_normaliseResult] Processing ${pid}: score=${score}`);

      // Normalise findings — backend may send strings or {type, text} objects
      const rawFindings = Array.isArray(entry.findings) ? entry.findings : [entry.findings || 'No findings.'];
      const findings = rawFindings.map(f =>
        typeof f === 'string'
          ? { type: score >= 40 ? 'ok' : score >= 25 ? 'warn' : 'risk', text: f }
          : f
      );

      // Normalise evidence — backend may send strings or objects
      const rawEvidence = Array.isArray(entry.evidence) ? entry.evidence : [];
      const evidenceSpans = rawEvidence.map(ev =>
        typeof ev === 'string' ? ev : (ev?.span || ev?.paper_span?.text || JSON.stringify(ev))
      );

      out[pid] = {
        score,
        normalizedScore: (score / 60) * 100,
        classification: entry.classification || entry.status || 'FAIL',
        status: entry.status || entry.classification || 'FAIL',
        findings,
        defensiveContext: false,
        pillar: PILLARS.find(p => p.id === pid),
        evidence: evidenceSpans,
        source_pdf: entry.source_pdf || 'N/A',
        improvements: Array.isArray(entry.improvements) ? entry.improvements
          : (Array.isArray(entry.required_improvements) ? entry.required_improvements : []),
        method: 'semantic-guideline',
      };
    });
  }

  // Fill any missing pillars with a safe fallback
  for (const p of PILLARS) {
    if (!out[p.id]) {
      console.log(`[_normaliseResult] Filling fallback for pillar: ${p.id}`);
      out[p.id] = {
        score: 0,
        normalizedScore: 0,
        classification: 'FAIL',
        status: 'FAIL',
        findings: [{ type: 'warn', text: 'No signals detected.' }],
        defensiveContext: false,
        pillar: p,
        evidence: [],
        source_pdf: 'N/A',
        improvements: ['Add explicit guideline-aligned compliance details for this pillar.'],
        method: 'fallback'
      };
    }
  }

  const result = {
    results: out,
    total_score: typeof raw.total_score === 'number' ? Math.max(0, Math.min(60, Math.round(raw.total_score))) : 0,
    status: raw.status || 'FAIL',
  };
  console.log("[_normaliseResult] Final output:", result);
  return result;
}

/**
 * auditTextSemantic — primary analysis entry point.
 */
async function auditTextSemantic(text) {
  try {
    const resp = await fetch(`https://bioethics-radar.onrender.com/api/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      console.error(`[BioEthics Radar] Backend error ${resp.status}: ${errBody}`);
      throw new Error(`Backend returned HTTP ${resp.status}`);
    }

    const json = await resp.json();
    console.log("[auditTextSemantic] Raw response:", json);
    if (typeof json.total_score !== 'number' || typeof json.status !== 'string' || !Array.isArray(json.results)) {
      throw new Error("Malformed response format");
    }
    return _normaliseResult(json);
  } catch (err) {
    console.error('[BioEthics Radar] Semantic analysis failed:', err);
    state.backendAvailable = false;
    throw err;
  }
}

/**
 * runAuditFromFile — sends a raw File object to /api/audit/file.
 */
async function runAuditFromFile(file, isV2 = false) {
  buildMobiusStrip();
  resetAllPillarLoaders();
  document.getElementById('dnaLoaderOverlay').hidden = false;
  document.getElementById('uploadSection').style.display = 'none';
  const stageEl = document.getElementById('dnaLoaderStage');
  if (stageEl) stageEl.textContent = 'Uploading & extracting document…';

  try {
    const formData = new FormData();
    formData.append('file', file);

    const resp = await fetch(`https://bioethics-radar.onrender.com/api/audit/file`, {
      method: 'POST',
      body: formData
    });

    if (!resp.ok) throw new Error(`Backend returned HTTP ${resp.status}`);

    const json = await resp.json();
    console.log("[runAuditFromFile] Raw response:", json);
    if (typeof json.total_score !== 'number' || typeof json.status !== 'string' || !Array.isArray(json.results)) {
      throw new Error("Malformed response format");
    }

    const normalized = _normaliseResult(json);
    const textForUI = `[Full PDF analysed server-side: ${file.name}]\n\nSemantic analysis processed ${json.chars_analyzed || '?'} characters across all document sections.`;
    document.getElementById('abstractTextarea').value = textForUI;

    await _finaliseAuditUI(normalized, textForUI, isV2);

  } catch (err) {
    console.error('[BioEthics Radar] File audit failed:', err);
    document.getElementById('dnaLoaderOverlay').hidden = true;
    document.getElementById('uploadSection').style.display = '';
    document.getElementById('abstractTextarea').value = `File analysis failed: ${err.message}. Please paste the text manually.`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// 8. AUDIT RUNNER
// ═══════════════════════════════════════════════════════════════════

let specimenCounter = 1;

async function _finaliseAuditUI(payload, text, isV2 = false) {
  console.log("[_finaliseAuditUI] Payload structure:", payload);
  console.log("[_finaliseAuditUI] Total score:", payload.total_score, "Type:", typeof payload.total_score);
  console.log("[_finaliseAuditUI] Status:", payload.status);
  console.log("[_finaliseAuditUI] Results:", payload.results);

  STATE.auditResults = payload.results;
  STATE.totalScore = payload.total_score || 0;
  STATE.overallStatus = payload.status || 'FAIL';
  STATE.evidenceSpans = PILLARS
    .map(p => {
      const ev = STATE.auditResults[p.id]?.evidence?.[0];
      return typeof ev === 'string' ? ev : ev?.span || null;
    })
    .filter(Boolean);
  STATE.bslValidated = SAFETY_TOKENS.some(t => text.toLowerCase().includes(t.toLowerCase()));

  await animatePillarLoaders(STATE.auditResults);
  await sleep(500);

  document.getElementById('dnaLoaderOverlay').hidden = true;
  document.getElementById('workspace').hidden = false;

  const pill = document.getElementById('auditStatusPill');
  pill.textContent = `Audit Complete · Total ${STATE.totalScore}/60 · ${STATE.overallStatus}`;
  pill.className = 'status-pill ' + (STATE.overallStatus === 'PASS' ? 'complete' : 'active');

  document.getElementById('specimenId').textContent = `SPX-2026-${String(specimenCounter++).padStart(3, '0')}`;
  document.getElementById('auditTimestamp').textContent = new Date().toLocaleTimeString();

  renderMarkList(STATE.auditResults);
  renderRoseChart();
  renderGelStrips();
  renderAbstractBody(text);
  renderScoreTable();
  showBSLShield(STATE.bslValidated);

  if (isV2 && STATE.v1Scores) showDeltaBanner();

  document.getElementById('workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function runAudit(text, isV2 = false) {
  STATE.abstractText = text;
  STATE.v1Scores = STATE.v1Scores || JSON.parse(localStorage.getItem(LS_KEY) || 'null');

  buildMobiusStrip();
  resetAllPillarLoaders();
  document.getElementById('dnaLoaderOverlay').hidden = false;
  document.getElementById('uploadSection').style.display = 'none';

  const payload = await auditTextSemantic(text);
  await _finaliseAuditUI(payload, text, isV2);
}

// ═══════════════════════════════════════════════════════════════════
// 9. D3 NIGHTINGALE ROSE CHART (sequence strip)
// ═══════════════════════════════════════════════════════════════════

function renderRoseChart() {
  const container = document.getElementById('chartContainer');
  const svg = document.getElementById('roseChart');
  if (svg) svg.style.display = 'none';
  container.innerHTML = `<div class="seq-strip-wrap"></div>`;
  const wrap = container.querySelector('.seq-strip-wrap');
  PILLARS.forEach((p, i) => {
    const r = STATE.auditResults[p.id];
    const normalized = r.normalizedScore || 0;
    const lane = document.createElement('div');
    lane.className = 'seq-strip-lane';
    lane.innerHTML = `
      <div class="seq-strip-head">
        <span>${p.name}</span>
        <span>${r.score}/60</span>
      </div>
      <div class="seq-strip-track">
        <div class="seq-strip-fill" id="seq-fill-${p.id}" style="width:0%;"></div>
      </div>
      <div class="seq-strip-meta">${r.source_pdf || 'N/A'}</div>
    `;
    lane.addEventListener('click', () => focusPillar(p.id));
    wrap.appendChild(lane);
    setTimeout(() => {
      const el = document.getElementById(`seq-fill-${p.id}`);
      if (el) el.style.width = `${normalized}%`;
    }, 120 + i * 120);
  });
}

// ═══════════════════════════════════════════════════════════════════
// 10. MOBILE GEL STRIPS
// ═══════════════════════════════════════════════════════════════════

function renderGelStrips() {
  const container = document.getElementById('gelStrips');
  container.innerHTML = '';
  PILLARS.forEach((p, i) => {
    const r = STATE.auditResults[p.id];
    const normalized = r.normalizedScore || 0;
    const color = scoreToViridis(normalized);
    const risk = scoreToRiskLabel(normalized);
    const lane = document.createElement('div');
    lane.className = 'gel-lane glass';
    lane.innerHTML = `
      <div class="gel-lane-header" role="button" tabindex="0" onclick="toggleGelLane(this)" onkeydown="if(event.key==='Enter')toggleGelLane(this)">
        <div class="gel-lane-name">${p.name}</div>
        <div class="gel-lane-score" style="color:${color}">${r.score}/60</div>
        <span class="gel-chevron">▾</span>
      </div>
      <div class="gel-band" id="gel-band-${i}" style="width:0%;background:${color}"></div>
      <div class="gel-lane-detail">
        ${r.findings.slice(0, 4).map(f => {
      const text = typeof f === 'string' ? f : f.text;
      const type = typeof f === 'string' ? 'ok' : f.type;
      return `<div class="finding-item"><span class="finding-dot ${type}"></span><span>${text}</span></div>`;
    }).join('')}
      </div>
    `;
    container.appendChild(lane);
    setTimeout(() => { const b = document.getElementById(`gel-band-${i}`); if (b) b.style.width = `${normalized}%`; }, 200 + i * 150);
  });
}

window.toggleGelLane = function (header) {
  const lane = header.closest('.gel-lane');
  lane.classList.toggle('expanded');
};

// ═══════════════════════════════════════════════════════════════════
// 11. ABSTRACT TOKEN HIGHLIGHTER
// ═══════════════════════════════════════════════════════════════════

function renderAbstractBody(text) {
  const container = document.getElementById('abstractBody');
  let html = escapeHtml(text);
  SAFETY_TOKENS.forEach(tok => {
    html = html.replace(new RegExp(`(${escapeRegex(tok)})`, 'gi'), `<span class="token-safety">$1</span>`);
  });
  PATHOGEN_TOKENS.forEach(tok => {
    html = html.replace(new RegExp(`(?<!<[^>]*)(${escapeRegex(tok)})(?![^<]*>)`, 'gi'), (match, p1, offset, str) => {
      const before = str.slice(0, offset);
      const open = (before.match(/<span/g) || []).length;
      const close = (before.match(/<\/span>/g) || []).length;
      if (open > close) return p1;
      return `<span class="token-pathogen">${p1}</span>`;
    });
  });
  STATE.evidenceSpans.forEach(span => {
    const snippet = escapeRegex(span.slice(0, 80).trim());
    if (snippet.length > 20) {
      html = html.replace(new RegExp(`(${snippet})`, 'i'), `<span class="token-safety">$1</span>`);
    }
  });
  html = html.split('\n\n').map(p => `<p>${p.replace(/\n/g, ' ')}</p>`).join('');
  container.innerHTML = html;
}

function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ═══════════════════════════════════════════════════════════════════
// 12. PROTOCOL SIDEBAR
// ═══════════════════════════════════════════════════════════════════

const PILLAR_KEYWORDS = {
  biosafety: ['BSL', 'IBC', 'biosafety', 'containment', 'DURC', 'Select Agent', 'pathogen', 'anthrax', 'Bacillus'],
  consent: ['IRB', 'consent', 'Helsinki', 'ethics committee', 'voluntary', 'participant', 'animal'],
  environmental: ['environment', 'ecological', 'greenhouse', 'Cartagena', 'biodiversity', 'waste'],
  data: ['de-identified', 'genomic', 'data', 'GDPR', 'HIPAA', 'privacy', 'repository'],
  justice: ['benefit', 'equitable', 'MTA', 'Nagoya', 'LMIC', 'community', 'vulnerable'],
};

function focusPillar(pillarId) {
  STATE.activePillarId = pillarId;
  const pillar = PILLARS.find(p => p.id === pillarId);
  const result = STATE.auditResults[pillarId];
  const color = scoreToViridis(result.normalizedScore || 0);
  const clauses = REGULATORY_CLAUSES[pillarId] || [];

  document.getElementById('sidebarIdle').hidden = true;
  document.getElementById('sidebarContent').hidden = false;

  const tag = document.getElementById('obsPillarTag');
  tag.textContent = pillar.name; tag.style.color = color; tag.style.borderColor = color;

  const scoreEl = document.getElementById('obsScore');
  scoreEl.textContent = `${result.score}/60`; scoreEl.style.color = color;

  const sentences = STATE.abstractText.match(/[^.!?]+[.!?]+/g) || [];
  const kws = PILLAR_KEYWORDS[pillarId] || [];
  let excerpt = null;
  for (const kw of kws) {
    const m = sentences.find(s => s.toLowerCase().includes(kw.toLowerCase()));
    if (m) { excerpt = m.trim().slice(0, 220) + (m.length > 220 ? '…' : ''); break; }
  }
  document.getElementById('obsFocusedText').textContent = excerpt ? `"${excerpt}"` : 'No specific excerpt identified.';

  document.getElementById('obsCitations').innerHTML = clauses.map(c => `
    <div class="citation-card">
      <div class="citation-source">${c.source}</div>
      <div class="citation-text">${c.text}</div>
    </div>
  `).join('');

  const fixes = (result.improvements || []).map(x => `<li>${x}</li>`).join('');
  const findingsHtml = result.findings.map(f => {
    const text = typeof f === 'string' ? f : f.text;
    const type = typeof f === 'string' ? 'ok' : f.type;
    return `<div class="finding-item"><span class="finding-dot ${type}"></span><span>${text}</span></div>`;
  }).join('');

  document.getElementById('obsFindings').innerHTML = findingsHtml + `
    <div class="finding-item"><span class="finding-dot warn"></span><span><strong>Source PDF:</strong> ${result.source_pdf || 'N/A'}</span></div>
    <div class="finding-item"><span class="finding-dot ok"></span><span><strong>Evidence:</strong> ${result.evidence?.[0] || 'No evidence span available.'}</span></div>
    <div class="finding-item"><span class="finding-dot risk"></span><span><strong>Required Fixes</strong><ul>${fixes || '<li>None noted.</li>'}</ul></span></div>
  ` || `<div class="finding-item"><span class="finding-dot warn"></span><span>No specific signals detected.</span></div>`;

  document.getElementById('protocolSidebar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ═══════════════════════════════════════════════════════════════════
// 13. SCORE TABLE
// ═══════════════════════════════════════════════════════════════════

function renderScoreTable() {
  const tbody = document.getElementById('scoreTableBody');
  tbody.innerHTML = '';
  const riskColors = { ok: 'var(--viridis-3)', warn: 'var(--viridis-2)', risk: 'var(--viridis-0)' };

  PILLARS.forEach(p => {
    const r = STATE.auditResults[p.id];
    const risk = scoreToRiskLabel(r.normalizedScore || 0);
    const color = scoreToViridis(r.normalizedScore || 0);
    const rc = riskColors[risk.cls];
    const topFinding = r.findings[0];
    const top = typeof topFinding === 'string' ? topFinding : (topFinding?.text || 'No signals detected');

    const tr = document.createElement('tr');
    tr.setAttribute('tabindex', '0');
    tr.innerHTML = `
      <td style="font-weight:600">${p.name}</td>
      <td class="td-score" style="color:${color}">
        <div class="td-bar"><span>${r.score}/60</span>
          <div class="bar-track"><div class="bar-fill" style="width:0%;background:${color}" data-w="${r.normalizedScore || 0}"></div></div>
        </div>
      </td>
      <td><span class="td-risk" style="color:${rc};border-color:${rc}">${r.classification || r.status || risk.label}</span></td>
      <td style="color:var(--c-text-secondary);font-size:0.78rem">${top}</td>
      <td class="td-framework">${r.source_pdf || p.frameworks[0]}</td>
    `;
    tr.addEventListener('click', () => focusPillar(p.id));
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') focusPillar(p.id); });
    tbody.appendChild(tr);
    setTimeout(() => { const bar = tr.querySelector('.bar-fill'); if (bar) bar.style.width = bar.dataset.w + '%'; }, 300);
  });
}

// ═══════════════════════════════════════════════════════════════════
// 14. BSL SHIELD + DELTA BANNER + EXPORT
// ═══════════════════════════════════════════════════════════════════

function showBSLShield(show) { document.getElementById('bslShieldWrap').hidden = !show; }

function showDeltaBanner() {
  const banner = document.getElementById('deltaBanner');
  banner.hidden = false;
  const deltas = PILLARS.map(p => ({
    name: p.short,
    delta: STATE.auditResults[p.id].score - (STATE.v1Scores[p.id] || 0),
  }));
  const improved = deltas.filter(d => d.delta > 0);
  const declined = deltas.filter(d => d.delta < 0);
  let desc = 'Ghost-stain (V1) vs current (V2) overlay active.';
  if (improved.length) desc += ` Improved: ${improved.map(d => `${d.name} +${d.delta}`).join(', ')}.`;
  if (declined.length) desc += ` Declined: ${declined.map(d => `${d.name} ${d.delta}`).join(', ')}.`;
  document.getElementById('deltaDescription').textContent = desc;
}

function setupExport() {
  document.getElementById('exportBtn').addEventListener('click', () => {
    if (!STATE.auditResults) return;
    let report = `BioEthics Radar — Ethics Audit Report\nGenerated: ${new Date().toISOString()}\n${'═'.repeat(60)}\n\n`;
    PILLARS.forEach(p => {
      const r = STATE.auditResults[p.id];
      const verdict = scoreToVerdict((r.score || 0), p.threshold);
      report += `PILLAR: ${p.name}\nScore: ${r.score}/60 | Verdict: ${r.classification || r.status || verdict.toUpperCase()} | Frameworks: ${p.frameworks.join(', ')}`;
      if (r.method) report += ` | Engine: ${r.method}`;
      report += '\n';
      r.findings.forEach(f => {
        const text = typeof f === 'string' ? f : f.text;
        const type = typeof f === 'string' ? 'INFO' : f.type.toUpperCase();
        report += `  [${type}] ${text}\n`;
      });
      (REGULATORY_CLAUSES[p.id] || []).forEach(c => { report += `  ${c.source}: ${c.text}\n`; });
      if (r.evidence && r.evidence.length > 0) {
        report += `  Grounded Evidence Spans:\n`;
        r.evidence.forEach((ev, i) => {
          const span = typeof ev === 'string' ? ev : (ev?.span || JSON.stringify(ev));
          report += `    [${i + 1}] "${span.slice(0, 300)}"\n`;
        });
      }
      report += `${'─'.repeat(60)}\n\n`;
    });
    const blob = new Blob([report], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'bioethics-audit-report.txt' });
    a.click();
  });
}

// ═══════════════════════════════════════════════════════════════════
// 15. THEME + RESIZE + INIT
// ═══════════════════════════════════════════════════════════════════

function initTheme() {
  const saved = localStorage.getItem('bioethics_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('bioethics_theme', next);
  });
}

function setupMisc() {
  document.getElementById('hideDeltaBtn').addEventListener('click', () => { document.getElementById('deltaBanner').hidden = true; });
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (STATE.auditResults) {
        if (window.innerWidth > 768) {
          renderRoseChart();
          document.getElementById('chartContainer').style.display = '';
          document.getElementById('gelStrips').hidden = true;
        } else {
          document.getElementById('chartContainer').style.display = 'none';
          document.getElementById('gelStrips').hidden = false;
          renderGelStrips();
        }
      }
    }, 200);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // Support V1 monochrome UI
  if (document.getElementById('paperText')) {
    setMeta('Ready');
    wireInput();
  }

  // Support V2 redesigned UI
  if (document.getElementById('abstractTextarea')) {
    initTheme();
    setupUpload();
    setupExport();
    setupMisc();
    const saved = localStorage.getItem(LS_KEY);
    if (saved) { try { STATE.v1Scores = JSON.parse(saved); } catch (e) { STATE.v1Scores = null; } }
  }
});