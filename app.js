/* GitHub Pages frontend. It intentionally contains no participant data or tokens. */
const API_URL = 'https://script.google.com/macros/s/AKfycbyo0yWPAcZIA_a4trJmkSNNqNzlLqGqrL09MFS9o4fSaN324rV_vt96qHbBSPJQcu58sA/exec';
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
const $ = id => document.getElementById(id);

function normalizedLanguage(value) {
  const source = String(value || '').toLowerCase();
  if (source.startsWith('ja')) return 'ja';
  if (source.startsWith('ko')) return 'ko';
  if (source.startsWith('en')) return 'en';
  return 'zh';
}
function interpolate(text, values) { return String(text).replace(/\{(\w+)\}/g, (_, key) => values && values[key] !== undefined ? values[key] : ''); }
function t(key, values) { return interpolate((window.TRANSLATIONS[currentLanguage] || window.TRANSLATIONS.zh)[key] || window.TRANSLATIONS.zh[key] || key, values); }
function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; }
function contentBlock(label, value, className, emphasis) { if (!value) return null; const box = el('div', 'content-block' + (className ? ' ' + className : '')); box.append(el('div', 'field-label', label), el('div', 'field-content' + (emphasis ? ' emphasis' : ''), value)); return box; }
function setMessage(element, text, isError) { element.textContent = text; element.className = 'inline-message' + (isError ? ' error' : ''); }
function setPortalReady(ready) { portalReady = ready; $('rsvp-button').disabled = !ready; }
function showError(title, copy) { document.body.dataset.state = 'invalid'; $('invalid-title').textContent = title; $('invalid-copy').textContent = copy; setPortalReady(false); }
function publicError(errorCode) { return errorCode === 'INVALID_LINK' ? t('invalidCopy') : t('requestFailed'); }

function renderIcons() { if (window.lucide) window.lucide.createIcons(); }
function applyStaticTranslations() {
  document.documentElement.lang = HTML_LANG[currentLanguage];
  document.title = t('title') + ' · ' + t('personalTask');
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(node => { node.placeholder = t(node.dataset.i18nPlaceholder); });
  $('language-label').textContent = t('langName');
  if (window.lucide && !document.querySelector('.language-button svg')) window.lucide.createIcons();
  document.querySelectorAll('.language-option').forEach(node => { node.setAttribute('aria-checked', String(node.dataset.lang === currentLanguage)); });
}
function captureFormState() {
  document.querySelectorAll('textarea[data-draft-id]').forEach(node => { formState.drafts[node.dataset.draftId] = node.value; });
  document.querySelectorAll('textarea[data-question-id]').forEach(node => { formState.questions[node.dataset.questionId] = node.value; });
  formState.rsvpNotes = $('rsvp-notes').value;
  document.querySelectorAll('details[data-transition-id]').forEach(node => { formState.transitions[node.dataset.transitionId] = node.open; });
}
function updateLanguageUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('lang', currentLanguage);
  window.history.replaceState({}, '', url);
}
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

async function apiGet() {
  const url = new URL(API_URL);
  url.searchParams.set('api', 'getMyData');
  url.searchParams.set('t', token);
  return fetchApi(url, { method: 'GET' });
}
async function apiPost(payload) {
  return fetchApi(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
}
async function fetchApi(url, options) {
  let response;
  try { response = await fetch(url, options); }
  catch (_) { throw new Error('NETWORK'); }
  if (!response.ok) throw new Error('NETWORK');
  let payload;
  try { payload = await response.json(); }
  catch (_) { throw new Error('NETWORK'); }
  if (!payload || payload.ok !== true) throw new Error(payload && payload.error || 'REQUEST_FAILED');
  return payload.data;
}

function assignmentTitle(a) {
  if (a.paragraph.startsWith('复习题')) return t('reviewQuestion', { number: a.paragraph.replace(/^复习题/, '') });
  return t('paragraph', { number: a.paragraph });
}
function queueLabel(a) { return a.side === 'L' ? t('queueLeft') : t('queueRight'); }
function makeAssignment(data, a) {
  const card = el('article', 'assignment-card');
  const head = el('div', 'assignment-head');
  const topline = el('div', 'assignment-topline');
  const titleWrap = el('div');
  titleWrap.append(el('div', 'assignment-paragraph', assignmentTitle(a)), el('div', 'assignment-kind', t(TYPE_KEYS[a.type] || 'comment') + ' · ' + t(a.side === 'L' ? 'left' : 'right')));
  topline.append(titleWrap, el('div', 'assignment-order', t('sequence', { number: a.order }))); head.append(topline);
  if (a.type !== 'Scripture') { const [label, tone] = STATUS_KEYS[a.status] || STATUS_KEYS['尚未提交']; head.append(el('div', 'status-pill ' + tone, t(label))); }
  card.append(head);
  const main = el('div', 'assignment-main');
  [contentBlock(t('question'), a.question), contentBlock(t('point'), a.point || t('scripturePoint'), 'key-point', true)].forEach(block => { if (block) main.append(block); });
  if (a.type !== 'Scripture') {
    if (a.status === '需要修改' && a.notes) main.append(contentBlock(t('reviewNote'), a.notes, 'review-note'));
    if (a.status === '已通过') { main.append(el('div', 'approval-heading', '✓ ' + t('approvedHeading'))); main.append(contentBlock(t('approvedVersion'), a.approved || t('approvedFallback'), 'approved-version')); }
    else { addDraftForm(main, a); }
  }
  card.append(main);
  const logistics = [[t('previous'), a.previous], [t('next'), a.next], [queueLabel(a), [a.samePrevious, '#' + a.order + ' ' + data.person.name, a.sameNext].filter(Boolean).join(' → ')]].filter(item => item[1]);
  if (logistics.length) { const details = el('details'); details.dataset.transitionId = a.id; details.open = preserveFormState && Object.prototype.hasOwnProperty.call(formState.transitions, a.id) ? formState.transitions[a.id] : true; const summary = el('summary', '', t('transitions')); const detailsContent = el('div', 'details-content'); logistics.forEach(item => detailsContent.append(contentBlock(item[0], item[1]))); details.append(summary, detailsContent); card.append(details); }
  if (flashMessage && flashMessage.id === a.id) { const flash = el('div', 'flash-success', '✓ ' + t('draftSaved', { version: flashMessage.version })); card.insertBefore(flash, card.querySelector('details')); }
  return card;
}
function addDraftForm(main, a) {
  if (a.latest) main.append(contentBlock(t('priorDraft', { version: a.latest.version }), a.latest.draft));
  const form = el('form', 'form-group');
  const draftSection = el('div', 'form-section');
  const draftId = 'draft-' + a.id; const draftLabel = el('label', 'form-label', t('draft')); draftLabel.htmlFor = draftId; draftSection.append(draftLabel);
  if (a.boundary) { const alert = el('div', 'boundary-alert'); const icon = el('i'); icon.setAttribute('data-lucide', 'triangle-alert'); icon.setAttribute('aria-hidden', 'true'); alert.append(icon, el('div', '', a.boundary)); draftSection.append(alert); }
  const draft = el('textarea'); draft.id = draftId; draft.dataset.draftId = a.id; draft.required = true; draft.maxLength = 5000; draft.placeholder = t('draftPlaceholder'); draft.value = preserveFormState && formState.drafts[a.id] !== undefined ? formState.drafts[a.id] : (a.latest ? a.latest.draft : ''); draftSection.append(draft);
  const questionSection = el('div', 'form-section');
  const questionId = 'question-' + a.id; const questionLabel = el('label', 'form-label', t('chairmanQuestion')); questionLabel.htmlFor = questionId; questionSection.append(questionLabel);
  const question = el('textarea', 'secondary'); question.id = questionId; question.dataset.questionId = a.id; question.maxLength = 1000; question.placeholder = t('chairmanPlaceholder'); question.value = preserveFormState && formState.questions[a.id] !== undefined ? formState.questions[a.id] : (a.latest ? a.latest.question : ''); questionSection.append(question);
  const button = el('button', 'primary-button', t('submitDraft')); button.type = 'submit'; const message = el('div', 'inline-message'); message.setAttribute('role', 'status'); form.append(draftSection, questionSection, button, message);
  form.addEventListener('submit', async event => {
    event.preventDefault(); button.disabled = true; button.textContent = t('submitting'); setMessage(message, t('savingDraft'));
    try { const result = await apiPost({ action: 'submitDraft', t: token, id: a.id, draft: draft.value, question: question.value }); flashMessage = { id: a.id, version: result.version }; Object.keys(formState.drafts).forEach(key => delete formState.drafts[key]); Object.keys(formState.questions).forEach(key => delete formState.questions[key]); currentData = await apiGet(); preserveFormState = false; render(currentData); }
    catch (error) { setMessage(message, error.message === 'NETWORK' ? t('networkError') : publicError(error.message), true); button.disabled = false; button.textContent = t('submitDraft'); }
  });
  main.append(form);
}

function render(data) {
  document.body.dataset.state = 'ready'; currentData = data; $('name').textContent = data.person.name; $('confirm').replaceChildren(); $('minor').replaceChildren();
  if (!data.person.confirmed) $('confirm').append(el('div', 'notice', t('unconfirmed')));
  if (data.person.minor) $('minor').append(el('div', 'notice minor', t('minor', { parent1: data.person.parent1, parent2: data.person.parent2 })));
  if (data.person.parentReminder) $('minor').append(el('div', 'notice minor', t('parentReminder', { name: data.person.minorChildName })));
  const root = $('assignments'); root.replaceChildren(); data.assignments.forEach(a => root.append(makeAssignment(data, a)));
  const saved = data.person.rehearsalStatus; if (saved) { const option = document.querySelector('input[name="availability"][value="' + saved + '"]'); if (option) option.checked = true; }
  $('rsvp-notes').value = preserveFormState ? formState.rsvpNotes : (data.person.rehearsalNotes || ''); renderIcons(); setPortalReady(true); flashMessage = null; preserveFormState = false;
}

function setupLanguageMenu() {
  const button = $('language-button'); const menu = $('language-options');
  button.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; button.setAttribute('aria-expanded', String(open)); });
  menu.addEventListener('click', event => { const item = event.target.closest('[data-lang]'); if (!item) return; menu.hidden = true; button.setAttribute('aria-expanded', 'false'); setLanguage(item.dataset.lang, { persist: true, updateUrl: true }); });
  document.addEventListener('click', event => { if (!event.target.closest('.language-menu')) { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { menu.hidden = true; button.setAttribute('aria-expanded', 'false'); button.focus(); } });
}

$('rsvp').addEventListener('submit', async event => {
  event.preventDefault(); if (!portalReady) return; const choice = document.querySelector('input[name="availability"]:checked'); const button = $('rsvp-button');
  if (!choice) { setMessage($('rsvp-message'), t('chooseAttendance'), true); return; }
  button.disabled = true; button.textContent = t('saving'); setMessage($('rsvp-message'), t('savingAttendance'));
  try { await apiPost({ action: 'submitRehearsal', t: token, availability: choice.value, notes: $('rsvp-notes').value }); setMessage($('rsvp-message'), t('attendanceSaved')); button.disabled = false; button.textContent = t('saveAttendance'); }
  catch (error) { setMessage($('rsvp-message'), error.message === 'NETWORK' ? t('networkError') : publicError(error.message), true); button.disabled = false; button.textContent = t('saveAttendance'); }
});

async function loadPortal() {
  token = new URLSearchParams(window.location.search).get('t') || '';
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) { showError(t('invalidTitle'), t('invalidCopy')); return; }
  try { currentData = await apiGet(); render(currentData); }
  catch (error) { if (error.message === 'INVALID_LINK') showError(t('invalidTitle'), t('invalidCopy')); else showError(t('loadFailed'), error.message === 'NETWORK' ? t('networkError') : publicError(error.message)); }
}

currentLanguage = initialLanguage(); applyStaticTranslations(); setupLanguageMenu(); loadPortal();
