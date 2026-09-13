/* GitHub Pages frontend. It intentionally contains no participant data or tokens. */
const API_URL = 'https://script.google.com/macros/s/AKfycbyo0yWPAcZIA_a4trJmkSNNqNzlLqGqrL09MFS9o4fSaN324rV_vt96qHbBSPJQcu58sA/exec';
const EVENT_CONFIG = {
  articleTitle: '一个基于爱心的请求',
  showPreparationSection: true
};
const SUPPORTED_LANGUAGES = ['zh', 'ja', 'ko', 'en'];
const HTML_LANG = { zh: 'zh-CN', ja: 'ja', ko: 'ko', en: 'en' };
const TYPE_KEYS = { Comment: 'comment', Scripture: 'scripture', Picture: 'picture', Review: 'review' };
const STATUS_KEYS = {
  '尚未提交': ['statusPending', 'pending'], '已提交': ['statusReview', 'pending'],
  '审核中': ['statusReviewing', 'pending'], '需要修改': ['statusRevision', 'revision'], '已通过': ['statusApproved', 'approved']
};

let token = '';
let currentLanguage = 'zh';
let currentData = null;
let flashMessage = null;
let portalReady = false;
let preserveFormState = false;
const formState = { drafts: {}, questions: {}, rsvpNotes: '', transitions: {} };
let lastDataSignature = '';
let refreshInFlight = false;
let pendingUpdateData = null;
let refreshFeedbackTimer = null;
const $ = id => document.getElementById(id);

function installUiTranslations() {
  Object.assign(window.TRANSLATIONS.zh, { approvedHeading: '已审核通过', updated: '已更新', preparationExpand: '展开评论与现场排练的安排', preparationCollapse: '折叠评论与现场排练的安排' });
  Object.assign(window.TRANSLATIONS.ja, { approvedHeading: '確認済み', updated: '更新済み', preparationExpand: 'コメントと現地リハーサルの予定を開く', preparationCollapse: 'コメントと現地リハーサルの予定を閉じる' });
  Object.assign(window.TRANSLATIONS.ko, { approvedHeading: '검토 승인됨', updated: '업데이트됨', preparationExpand: '해설 및 현장 리허설 안내 펼치기', preparationCollapse: '해설 및 현장 리허설 안내 접기' });
  Object.assign(window.TRANSLATIONS.en, { approvedHeading: 'Approved', updated: 'Updated', preparationExpand: 'Expand comment and rehearsal arrangements', preparationCollapse: 'Collapse comment and rehearsal arrangements' });
}
function normalizedLanguage(value) {
  const source = String(value || '').toLowerCase();
  if (source.startsWith('ja')) return 'ja';
  if (source.startsWith('ko')) return 'ko';
  if (source.startsWith('en')) return 'en';
  return 'zh';
}
function interpolate(text, values) { return String(text).replace(/\{(\w+)\}/g, (_, key) => values && values[key] !== undefined ? values[key] : ''); }
function t(key, values) {
  const current = window.TRANSLATIONS[currentLanguage] || {};
  const fallback = window.TRANSLATIONS.zh || {};
  let text;
  if (Object.prototype.hasOwnProperty.call(current, key)) text = current[key];
  else if (Object.prototype.hasOwnProperty.call(fallback, key)) text = fallback[key];
  else { console.warn('Missing translation: ' + key); text = ''; }
  return interpolate(text, values);
}
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; }
function contentBlock(label, value, className, emphasis) { if (!value) return null; const box = el('div', 'content-block' + (className ? ' ' + className : '')); box.append(el('div', 'field-label', label), el('div', 'field-content' + (emphasis ? ' emphasis' : ''), value)); return box; }
function setMessage(element, text, isError) { element.textContent = text; element.className = 'inline-message' + (isError ? ' error' : ''); }
function setPortalReady(ready) { portalReady = ready; const rsvpButton = $('rsvp-button'); if (rsvpButton) rsvpButton.disabled = !ready; }
function showError(title, copy) { document.body.dataset.state = 'invalid'; $('invalid-title').textContent = title; $('invalid-copy').textContent = copy; setPortalReady(false); }
function publicError(errorCode) { return errorCode === 'INVALID_LINK' ? t('invalidCopy') : t('requestFailed'); }
function renderIcons() { if (window.lucide) window.lucide.createIcons(); }
function updatePreparationA11y() {
  const details = $('preparation-details'); const summary = $('preparation-summary');
  if (!details || !summary) return;
  summary.setAttribute('aria-label', t(details.open ? 'preparationCollapse' : 'preparationExpand'));
}
function applyStaticTranslations() {
  document.documentElement.lang = HTML_LANG[currentLanguage];
  document.title = t('title') + ' · ' + t('personalTask');
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-aria]').forEach(node => { node.setAttribute('aria-label', t(node.dataset.i18nAria)); });
  $('language-label').textContent = t('langName');
  updatePreparationA11y();
  renderIcons();
  document.querySelectorAll('.language-option').forEach(node => { node.setAttribute('aria-checked', String(node.dataset.lang === currentLanguage)); });
}
function captureFormState() {
  document.querySelectorAll('textarea[data-draft-id]').forEach(node => { formState.drafts[node.dataset.draftId] = node.value; });
  document.querySelectorAll('textarea[data-question-id]').forEach(node => { formState.questions[node.dataset.questionId] = node.value; });
  formState.rsvpNotes = $('rsvp-notes').value;
  document.querySelectorAll('details[data-transition-id]').forEach(node => { formState.transitions[node.dataset.transitionId] = node.open; });
}
function updateLanguageUrl() { const url = new URL(window.location.href); url.searchParams.set('lang', currentLanguage); window.history.replaceState({}, '', url); }
function setLanguage(language, options) {
  const next = SUPPORTED_LANGUAGES.includes(language) ? language : 'zh';
  if (currentData) captureFormState();
  currentLanguage = next;
  if (options && options.persist) localStorage.setItem('wt-discussion-language', next);
  if (options && options.updateUrl) updateLanguageUrl();
  applyStaticTranslations();
  if (currentData) { preserveFormState = true; render(currentData); }
}
function initialLanguage() {
  const urlLanguage = new URLSearchParams(window.location.search).get('lang');
  if (SUPPORTED_LANGUAGES.includes(urlLanguage)) return urlLanguage;
  const saved = localStorage.getItem('wt-discussion-language');
  if (SUPPORTED_LANGUAGES.includes(saved)) return saved;
  return normalizedLanguage(navigator.language);
}
async function apiGet() { const url = new URL(API_URL); url.searchParams.set('api', 'getMyData'); url.searchParams.set('t', token); return fetchApi(url, { method: 'GET' }); }
async function apiPost(payload) { return fetchApi(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) }); }
async function fetchApi(url, options) {
  let response; try { response = await fetch(url, options); } catch (_) { throw new Error('NETWORK'); }
  if (!response.ok) throw new Error('NETWORK');
  let payload; try { payload = await response.json(); } catch (_) { throw new Error('NETWORK'); }
  if (!payload || payload.ok !== true) throw new Error(payload && payload.error || 'REQUEST_FAILED');
  return payload.data;
}
function assignmentTitle(a) { if (a.paragraph.startsWith('复习题')) return t('reviewQuestion', { number: a.paragraph.replace(/^复习题/, '') }); return t('paragraph', { number: a.paragraph }); }
function queueLabel(a) { return a.side === 'L' ? t('queueLeft') : t('queueRight'); }
function approvedBlock(text) {
  const box = el('section', 'approved-final');
  box.append(el('div', 'approved-final-heading', '✓ ' + t('approvedHeading')), el('div', 'approved-final-text', text));
  return box;
}
function makeAssignment(data, a) {
  const card = el('article', 'assignment-card'); card.dataset.assignmentId = a.id;
  const head = el('div', 'assignment-head'); const topline = el('div', 'assignment-topline'); const titleWrap = el('div');
  titleWrap.append(el('div', 'assignment-paragraph', assignmentTitle(a)), el('div', 'assignment-kind', t(TYPE_KEYS[a.type] || 'comment') + ' · ' + t(a.side === 'L' ? 'left' : 'right')));
  topline.append(titleWrap, el('div', 'assignment-order', t('sequence', { number: a.order }))); head.append(topline);
  if (a.type !== 'Scripture') { const [label, tone] = STATUS_KEYS[a.status] || STATUS_KEYS['尚未提交']; head.append(el('div', 'status-pill ' + tone, t(label))); }
  card.append(head);
  const main = el('div', 'assignment-main');
  [contentBlock(t('question'), a.question), contentBlock(t('point'), a.point || t('scripturePoint'), 'key-point', true)].forEach(block => { if (block) main.append(block); });
  if (a.type !== 'Scripture') {
    const approved = String(a.approved || '').trim();
    if (approved) main.append(approvedBlock(approved));
    if (a.status === '需要修改' && a.notes) main.append(contentBlock(t('reviewNote'), a.notes, 'review-note'));
    if (a.status !== '已通过') addDraftForm(main, a);
  }
  card.append(main);
  const logistics = [[t('previous'), a.previous], [t('next'), a.next], [queueLabel(a), [a.samePrevious, '#' + a.order + ' ' + data.person.name, a.sameNext].filter(Boolean).join(' → ')]].filter(item => item[1]);
  if (logistics.length) { const details = el('details'); details.dataset.transitionId = a.id; details.open = preserveFormState && Object.prototype.hasOwnProperty.call(formState.transitions, a.id) ? formState.transitions[a.id] : true; const summary = el('summary', '', t('transitions')); const detailsContent = el('div', 'details-content'); logistics.forEach(item => detailsContent.append(contentBlock(item[0], item[1]))); details.append(summary, detailsContent); card.append(details); }
  if (flashMessage && flashMessage.id === a.id) { const flash = el('div', 'flash-success', '✓ ' + t('draftSaved', { version: flashMessage.version })); card.insertBefore(flash, card.querySelector('details')); }
  return card;
}
function addDraftForm(main, a) {
  if (a.latest) main.append(contentBlock(t('priorDraft', { version: a.latest.version }), a.latest.draft));
  const form = el('form', 'form-group'); const draftSection = el('div', 'form-section');
  const draftId = 'draft-' + a.id; const draftLabel = el('label', 'form-label', t('draft')); draftLabel.htmlFor = draftId; draftSection.append(draftLabel);
  if (a.boundary) { const alert = el('div', 'boundary-alert'); const icon = el('i'); icon.setAttribute('data-lucide', 'triangle-alert'); icon.setAttribute('aria-hidden', 'true'); alert.append(icon, el('div', '', a.boundary)); draftSection.append(alert); }
  const draft = el('textarea'); draft.id = draftId; draft.dataset.draftId = a.id; draft.required = true; draft.maxLength = 5000; draft.placeholder = t('draftPlaceholder'); draft.dataset.serverValue = a.latest ? a.latest.draft : ''; draft.value = preserveFormState && formState.drafts[a.id] !== undefined ? formState.drafts[a.id] : draft.dataset.serverValue; draftSection.append(draft);
  const questionSection = el('div', 'form-section'); const questionId = 'question-' + a.id; const questionLabel = el('label', 'form-label', t('chairmanQuestion')); questionLabel.htmlFor = questionId; questionSection.append(questionLabel);
  const question = el('textarea', 'secondary'); question.id = questionId; question.dataset.questionId = a.id; question.maxLength = 1000; question.placeholder = t('chairmanPlaceholder'); question.dataset.serverValue = a.latest ? a.latest.question : ''; question.value = preserveFormState && formState.questions[a.id] !== undefined ? formState.questions[a.id] : question.dataset.serverValue; questionSection.append(question);
  const button = el('button', 'primary-button', t('submitDraft')); button.type = 'submit'; const message = el('div', 'inline-message'); message.setAttribute('role', 'status'); form.append(draftSection, questionSection, button, message);
  form.addEventListener('submit', async event => {
    event.preventDefault(); button.disabled = true; button.textContent = t('submitting'); setMessage(message, t('savingDraft'));
    try { const card = event.currentTarget.closest('.assignment-card'); const anchorTop = card.getBoundingClientRect().top; const result = await apiPost({ action: 'submitDraft', t: token, id: a.id, draft: draft.value, question: question.value }); flashMessage = { id: a.id, version: result.version }; Object.keys(formState.drafts).forEach(key => delete formState.drafts[key]); Object.keys(formState.questions).forEach(key => delete formState.questions[key]); preserveFormState = false; applyServerData(await apiGet(), { anchorId: a.id, anchorTop }); }
    catch (error) { setMessage(message, error.message === 'NETWORK' ? t('networkError') : publicError(error.message), true); button.disabled = false; button.textContent = t('submitDraft'); }
  });
  main.append(form);
}
function compactNotice(text) { const note = el('div', 'notice minor'); const icon = el('i'); icon.setAttribute('data-lucide', 'info'); icon.setAttribute('aria-hidden', 'true'); note.append(icon, el('div', '', text)); return note; }
function effectiveArticleTitle(data) { return String((data && data.articleTitle) || EVENT_CONFIG.articleTitle || '').trim(); }
function render(data) {
  document.body.dataset.state = 'ready'; currentData = data; $('name').textContent = data.person.name;
  const article = effectiveArticleTitle(data); $('article-summary').hidden = !article; $('article-title').textContent = article; $('confirm').replaceChildren(); $('minor').replaceChildren();
  if (!data.person.confirmed) $('confirm').append(el('div', 'notice', t('unconfirmed')));
  if (data.person.minor) $('minor').append(compactNotice(t('minor', { parent1: data.person.parent1, parent2: data.person.parent2 })));
  if (data.person.parentReminder) $('minor').append(compactNotice(t('parentReminder', { name: data.person.minorChildName })));
  const root = $('assignments'); root.replaceChildren(); data.assignments.forEach(a => root.append(makeAssignment(data, a)));
  const saved = data.person.rehearsalStatus; document.querySelectorAll('input[name="availability"]').forEach(option => { option.checked = option.value === saved; });
  $('rsvp-notes').dataset.serverValue = data.person.rehearsalNotes || ''; $('rsvp-notes').value = preserveFormState ? formState.rsvpNotes : $('rsvp-notes').dataset.serverValue;
  renderIcons(); setPortalReady(true); flashMessage = null; preserveFormState = false;
}
function setupLanguageMenu() {
  const button = $('language-button'); const menu = $('language-options');
  button.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; button.setAttribute('aria-expanded', String(open)); });
  menu.addEventListener('click', event => { const item = event.target.closest('[data-lang]'); if (!item) return; menu.hidden = true; button.setAttribute('aria-expanded', 'false'); setLanguage(item.dataset.lang, { persist: true, updateUrl: true }); });
  document.addEventListener('click', event => { if (!event.target.closest('.language-menu')) { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); button.focus(); } });
}
function setupPreparationSection() {
  const section = $('preparation-section'); const details = $('preparation-details');
  section.hidden = !EVENT_CONFIG.showPreparationSection;
  if (!EVENT_CONFIG.showPreparationSection) return;
  details.open = localStorage.getItem('preparationSectionCollapsed') !== 'true';
  updatePreparationA11y();
  details.addEventListener('toggle', () => { localStorage.setItem('preparationSectionCollapsed', String(!details.open)); updatePreparationA11y(); });
}
$('rsvp').addEventListener('submit', async event => {
  event.preventDefault(); if (!portalReady) return; const choice = document.querySelector('input[name="availability"]:checked'); const button = $('rsvp-button');
  if (!choice) { setMessage($('rsvp-message'), t('chooseAttendance'), true); return; }
  button.disabled = true; button.textContent = t('saving'); setMessage($('rsvp-message'), t('savingAttendance'));
  try { await apiPost({ action: 'submitRehearsal', t: token, availability: choice.value, notes: $('rsvp-notes').value }); $('rsvp-notes').dataset.serverValue = $('rsvp-notes').value; if (currentData) { currentData.person.rehearsalStatus = choice.value; currentData.person.rehearsalNotes = $('rsvp-notes').value; lastDataSignature = dataSignature(currentData); } setMessage($('rsvp-message'), t('attendanceSaved')); button.disabled = false; button.textContent = t('saveAttendance'); }
  catch (error) { setMessage($('rsvp-message'), error.message === 'NETWORK' ? t('networkError') : publicError(error.message), true); button.disabled = false; button.textContent = t('saveAttendance'); }
});
function dataSignature(data) { return JSON.stringify({ articleTitle: effectiveArticleTitle(data), rehearsal: [data.person.rehearsalStatus || '', data.person.rehearsalNotes || ''], assignments: data.assignments.map(a => [a.id, a.status, a.notes || '', a.approved || '', a.latest ? a.latest.version : 0, a.latest ? a.latest.draft : '', a.latest ? a.latest.question : '']) }); }
function hasUnsavedEdits() { const textDirty = [...document.querySelectorAll('textarea[data-server-value]')].some(node => node.value !== node.dataset.serverValue); const current = document.querySelector('input[name="availability"]:checked'); const saved = currentData && currentData.person.rehearsalStatus || ''; return textDirty || !!(current && current.value !== saved); }
function restoreTaskPosition(id, top) { if (top === null || top === undefined) return; requestAnimationFrame(() => { const card = document.querySelector('[data-assignment-id="' + id + '"]'); if (card) window.scrollBy(0, card.getBoundingClientRect().top - top); }); }
function applyServerData(data, options) { const scrollY = window.scrollY; lastDataSignature = dataSignature(data); pendingUpdateData = null; $('update-notice').hidden = true; render(data); if (options && options.anchorId) restoreTaskPosition(options.anchorId, options.anchorTop); else requestAnimationFrame(() => window.scrollTo(0, scrollY)); }
function showRefreshSuccess() {
  const label = $('refresh-label'); if (!label) return; clearTimeout(refreshFeedbackTimer); label.textContent = t('updated') + ' ✓';
  refreshFeedbackTimer = setTimeout(() => { label.textContent = t('refresh'); }, 2400);
}
async function refreshData() {
  if (!portalReady || refreshInFlight) return;
  refreshInFlight = true; const button = $('refresh-button'); button.disabled = true; button.classList.add('is-loading');
  try { const next = await apiGet(); const changed = dataSignature(next) !== lastDataSignature; if (changed && hasUnsavedEdits()) { pendingUpdateData = next; $('update-notice').hidden = false; } else if (changed) applyServerData(next); showRefreshSuccess(); }
  catch (_) { /* Keep the current page intact; the user can retry manually. */ }
  finally { refreshInFlight = false; button.disabled = false; button.classList.remove('is-loading'); }
}
function setupRefresh() {
  $('refresh-button').addEventListener('click', refreshData);
  $('view-update').addEventListener('click', () => { if (!pendingUpdateData) return; if (hasUnsavedEdits() && !window.confirm(t('unsavedUpdateConfirm'))) return; applyServerData(pendingUpdateData); });
}
async function loadPortal() {
  token = new URLSearchParams(window.location.search).get('t') || '';
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) { showError(t('invalidTitle'), t('invalidCopy')); return; }
  try { applyServerData(await apiGet()); }
  catch (error) { if (error.message === 'INVALID_LINK') showError(t('invalidTitle'), t('invalidCopy')); else showError(t('loadFailed'), error.message === 'NETWORK' ? t('networkError') : publicError(error.message)); }
}

installUiTranslations();
currentLanguage = initialLanguage();
setupPreparationSection();
applyStaticTranslations();
setupLanguageMenu();
setupRefresh();
loadPortal();