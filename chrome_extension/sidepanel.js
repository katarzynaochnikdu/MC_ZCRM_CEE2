// Sidepanel - wyświetlanie stanów Gmaila (ETAP 1 + ETAP 2)

// Import loggera
const sidepanelLogger = new Logger('Sidepanel');
sidepanelLogger.captureConsole(); // Przechwytuj wszystko z konsoli
if (!window.loggers) window.loggers = [];
window.loggers.push(sidepanelLogger);

const messageIdElement = document.getElementById('messageId');
const threadIdElement = document.getElementById('threadId');
const statusElement = document.getElementById('status');

// ETAP 2: Elementy dla pobranych danych
const fetchedDataSection = document.getElementById('fetchedDataSection');
const fetchedData = document.getElementById('fetchedData');

// ETAP 2*: Przycisk pobierania wątku
const fetchThreadBtn = document.getElementById('fetchThreadBtn');

// ETAP 4: Przycisk analizy LLM
const analyzeLLMBtn = document.getElementById('analyzeLLMBtn');
const analysisSection = document.getElementById('analysisSection');
const analysisData = document.getElementById('analysisData');
const cardsSection = document.getElementById('cardsSection');
const tabButtons = document.querySelectorAll('#cardsSection .tab');
const accountsTab = document.getElementById('tab-accounts');
const contactsTab = document.getElementById('tab-contacts');

// Przycisk czyszczenia cache + etykieta źródła danych
const clearCacheBtn = document.getElementById('clearCacheBtn');
const dataSourceLabel = document.getElementById('dataSourceLabel');

// ETAP 2: Przechowuje aktualny stan (aby ignorować nieaktualne dane)
let currentState = null;

// ETAP 2*: Thread Intelligence - state machine
let threadState = {
  currentView: 'auto',  // 'auto' | 'message' | 'thread'
  currentMessageId: null,
  currentThreadId: null,
  messageMetadataLoaded: false,
  threadMetadataLoaded: false,
  threadFullLoaded: false,
  messageCount: 0,
  // Czy ten wątek był kiedyś pobierany jako pełny (z background cache)
  hasFullThreadFetchedBefore: false,
  cachedThreads: {}  // { threadId: data }
};

// ETAP 4: LLM Analysis state
let llmState = {
  hasAnalysis: false,
  analysisData: null,
  isAnalyzing: false
};

if (tabButtons && tabButtons.length && accountsTab && contactsTab) {
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      tabButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.tab;
      if (target === 'accounts') {
        accountsTab.classList.add('active');
        contactsTab.classList.remove('active');
      } else if (target === 'contacts') {
        contactsTab.classList.add('active');
        accountsTab.classList.remove('active');
      }
    });
  });
}

// ETAP 2*: Funkcja czyszcząca sekcję wyników
function resetFetchedData() {
  if (fetchedData) {
    fetchedData.textContent = '';
  }
  if (fetchedDataSection) {
    fetchedDataSection.style.display = 'none';
  }
  console.log('[Sidepanel] Wyczyszczono sekcję pobranych danych');
}

// ETAP 4: Funkcja czyszcząca sekcję analizy LLM
function resetAnalysisData() {
  if (analysisData) {
    analysisData.textContent = '';
  }
  if (analysisSection) {
    analysisSection.style.display = 'none';
  }
  if (dataSourceLabel) {
    dataSourceLabel.style.display = 'none';
    dataSourceLabel.textContent = '';
  }
  llmState.hasAnalysis = false;
  llmState.analysisData = null;
  llmState.isAnalyzing = false;
  resetCardsSection();
  console.log('[Sidepanel] Wyczyszczono sekcję analizy LLM');
}

// Funkcja ustawiająca etykietę źródła danych
function setDataSourceLabel(source) {
  if (!dataSourceLabel) return;
  
  dataSourceLabel.style.display = 'inline-block';
  
  if (source === 'cache') {
    dataSourceLabel.textContent = '📦 local cache';
    dataSourceLabel.className = 'data-source-label source-cache';
  } else if (source === 'firestore') {
    dataSourceLabel.textContent = '🔥 Firestore';
    dataSourceLabel.className = 'data-source-label source-firestore';
  } else if (source === 'fresh') {
    dataSourceLabel.textContent = '✨ fresh LLM';
    dataSourceLabel.className = 'data-source-label source-fresh';
  } else {
    dataSourceLabel.style.display = 'none';
  }
}

function resetCardsSection() {
  cardsState.accounts = [];
  cardsState.contacts = [];
  if (accountsTab) {
    accountsTab.innerHTML = '';
  }
  if (contactsTab) {
    contactsTab.innerHTML = '';
  }
  if (cardsSection) {
    cardsSection.style.display = 'none';
  }
}

// ETAP 2*: Thread Intelligence - reset state
function resetThreadState() {
  threadState.messageMetadataLoaded = false;
  threadState.threadMetadataLoaded = false;
  threadState.threadFullLoaded = false;
  threadState.messageCount = 0;
  threadState.hasFullThreadFetchedBefore = false;
  threadState.currentView = 'auto';
  
  // Reset przycisku (kompaktowy)
  if (fetchThreadBtn) {
    fetchThreadBtn.textContent = '🧵 Wątek';
    fetchThreadBtn.title = 'Pobierz cały wątek';
    fetchThreadBtn.disabled = false;
  }
  
  console.log('[Sidepanel] 🧠 Thread state zresetowany');
}

// Mapowanie stanów na czytelne nazwy (kompaktowe)
const STAN_NAMES = {
  'loading': '⏳',
  'inbox_list': '📋',
  'mail_opened': '📧',
  'mail_changed': '🔄',
  'thread_view': '🧵'
};

// Mapowanie stanów na kolory statusu
const STAN_COLORS = {
  'loading': 'status loading',
  'inbox_list': 'status inactive',
  'mail_opened': 'status active',
  'mail_changed': 'status active',
  'thread_view': 'status active'
};

// Pełne nazwy stanów (do tooltipa)
const STAN_TITLES = {
  'loading': 'Ładowanie Gmaila...',
  'inbox_list': 'Lista maili',
  'mail_opened': 'Mail otwarty',
  'mail_changed': 'Zmiana maila',
  'thread_view': 'Widok wątku'
};

const CATEGORY_ORDER = {
  existing_enrichable: 0,
  possible_match: 1,
  new_complete: 2,
  new_partial: 3,
  existing_complete: 4
};

const CATEGORY_BADGES = {
  existing_enrichable: { className: 'badge-existing_enrichable', label: 'existing enrichable' },
  possible_match: { className: 'badge-possible_match', label: 'possible match' },
  new_complete: { className: 'badge-new_complete', label: 'new complete' },
  new_partial: { className: 'badge-new_partial', label: 'new partial' },
  existing_complete: { className: 'badge-existing_complete', label: 'existing complete' }
};

let cardsState = {
  accounts: [],
  contacts: []
};

// ETAP 1: Funkcja aktualizująca UI na podstawie stanu Gmaila
function updateUI(state) {
  // ETAP 2*: Sprawdź czy zmienił się mail/wątek (przed zapisaniem nowego stanu)
  const previousState = currentState;
  const shouldReset = 
    !state || 
    state.stan !== 'mail_opened' || 
    (previousState && state.messageId !== previousState.messageId) ||
    (previousState && state.threadId !== previousState.threadId);

  // Zapisz aktualny stan (ETAP 2: do weryfikacji czy dane są aktualne)
  currentState = state;

  // ETAP 2*: Wyczyść wyniki jeśli zmienił się kontekst
  if (shouldReset) {
    resetFetchedData();
    resetThreadState();
    resetAnalysisData(); // ETAP 4: Wyczyść też analizę LLM
  }
  
  // ETAP 2*: Zaktualizuj thread state IDs
  threadState.currentMessageId = state?.messageId || null;
  threadState.currentThreadId = state?.threadId || null;

  if (!state) {
    // Brak stanu - nie jesteśmy w Gmail lub jeszcze nie wykryto
    statusElement.textContent = '⏸';
    statusElement.className = 'status inactive';
    statusElement.title = 'Oczekiwanie...';
    messageIdElement.textContent = '-';
    messageIdElement.title = 'Nie wykryto stanu Gmaila';
    threadIdElement.textContent = '-';
    threadIdElement.title = '';
    return;
  }

  // Aktualizuj status (kompaktowy)
  statusElement.textContent = STAN_NAMES[state.stan] || '❓';
  statusElement.className = STAN_COLORS[state.stan] || 'status inactive';
  statusElement.title = STAN_TITLES[state.stan] || 'Nieznany stan';

  // Aktualizuj messageId (kompaktowy format)
  if (state.messageId) {
    // Skrócony messageId dla kompaktowego widoku
    const shortMsgId = state.messageId.length > 8 ? state.messageId.slice(0, 8) + '…' : state.messageId;
    
    // ZAWSZE pokaż przycisk analizy gdy jest messageId (nie czekaj na processed)
    if (analyzeLLMBtn) {
      analyzeLLMBtn.style.display = 'block';
      analyzeLLMBtn.textContent = '🤖 Analizuj';
      analyzeLLMBtn.title = 'Analizuj wiadomość przez LLM';
      analyzeLLMBtn.disabled = false;
    }
    
    // ETAP 4: Sprawdź czy wiadomość ma już analizę w cache
    chrome.runtime.sendMessage({
      type: 'get-message-cache',
      messageId: state.messageId
    }).then(response => {
      if (response && response.cache && response.cache.hasAnalysis) {
        llmState.hasAnalysis = true;
        llmState.analysisData = response.cache.analysisData;
        messageIdElement.innerHTML = `${shortMsgId}<span class="has-analysis-check">✓</span>`;
        messageIdElement.title = state.messageId + ' (analiza dostępna)';
        
        // Zmień przycisk na "Zobacz" (analiza już jest)
        if (analyzeLLMBtn) {
          analyzeLLMBtn.textContent = '🤖 Zobacz';
          analyzeLLMBtn.title = 'Zobacz analizę LLM';
        }
        if (response.cache.analysisData) {
          displayAnalysisData(response.cache.analysisData);
          renderCards(response.cache.analysisData);
        }
      } else {
        llmState.hasAnalysis = false;
        llmState.analysisData = null;
        messageIdElement.textContent = shortMsgId;
        messageIdElement.title = state.messageId;
        resetCardsSection();
        // Przycisk "Analizuj" już jest widoczny (ustawiony wyżej)
      }
    }).catch(() => {
      messageIdElement.textContent = shortMsgId;
      messageIdElement.title = state.messageId;
      // Przycisk "Analizuj" pozostaje widoczny nawet przy błędzie cache
    });
  } else {
    messageIdElement.textContent = '-';
    messageIdElement.title = 'Brak messageId';
    if (analyzeLLMBtn) {
      analyzeLLMBtn.style.display = 'none';
    }
  }

  // Aktualizuj threadId (kompaktowy format)
  if (state.threadId) {
    const shortThdId = state.threadId.length > 8 ? state.threadId.slice(0, 8) + '…' : state.threadId;
    threadIdElement.textContent = shortThdId;
    threadIdElement.title = state.threadId;
    // ETAP 2*: Pokaż przycisk pobierania wątku
    if (fetchThreadBtn) {
      fetchThreadBtn.style.display = 'block';
    }
  } else {
    threadIdElement.textContent = '-';
    threadIdElement.title = 'Brak threadId';
    // ETAP 2*: Ukryj przycisk pobierania wątku
    if (fetchThreadBtn) {
      fetchThreadBtn.style.display = 'none';
    }
  }

  console.log('[Sidepanel] Zaktualizowano UI stanem:', state);
}

// ETAP 2: Funkcja wyświetlająca pobrane dane z Gmail API
function displayFetchedData(data, type) {
  const startTime = performance.now();
  
  // ETAP 2*: Sprawdź czy dane są aktualne (messageId musi się zgadzać)
  if (type === 'message' && data.messageId !== currentState?.messageId) {
    console.log('[Sidepanel] Ignoruję nieaktualne dane (message):', data.messageId, '!==', currentState?.messageId);
    resetFetchedData(); // Wyczyść sekcję
    return;
  }
  if (type === 'thread' && data.threadId !== currentState?.threadId) {
    console.log('[Sidepanel] Ignoruję nieaktualne dane (thread):', data.threadId, '!==', currentState?.threadId);
    resetFetchedData(); // Wyczyść sekcję
    return;
  }

  // Pokaż sekcję danych
  fetchedDataSection.style.display = 'block';

  // Wyświetl dane w formacie JSON
  const jsonString = JSON.stringify(data, null, 2);
  fetchedData.textContent = jsonString;
  
  const renderTime = performance.now() - startTime;
  const dataSize = new Blob([jsonString]).size;
  
  console.log(`[Sidepanel] 📊 Wyświetlono dane (${type}): ${renderTime.toFixed(1)}ms, ${dataSize} bytes`);
  
  if (sidepanelLogger) {
    sidepanelLogger.info(`📊 Performance Display (${type})`, {
      renderTime: `${renderTime.toFixed(1)}ms`,
      dataSize: `${dataSize} bytes`,
      messageCount: type === 'thread' ? (data.messageCount || 1) : 1,
      messageId: data.messageId || '-',
      threadId: data.threadId || '-'
    });
  }
}

// ETAP 4: Funkcja wyświetlająca analizę LLM
function displayAnalysisData(analysis) {
  const startTime = performance.now();
  
  analysisSection.style.display = 'block';
  const jsonString = JSON.stringify(analysis, null, 2);
  analysisData.textContent = jsonString;
  
  const renderTime = performance.now() - startTime;
  const dataSize = new Blob([jsonString]).size;
  
  console.log(`[Sidepanel] 🤖 Wyświetlono analizę LLM: ${renderTime.toFixed(1)}ms, ${dataSize} bytes`);
  
  if (sidepanelLogger) {
    sidepanelLogger.info('🤖 Performance LLM Analysis Display', {
      renderTime: `${renderTime.toFixed(1)}ms`,
      dataSize: `${dataSize} bytes`,
      companiesCount: analysis.companies?.length || 0,
      contactsCount: analysis.contacts?.length || 0
    });
  }
}

function formatCompanyNameUpper(name = '') {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\s+/g, ' ').toUpperCase();
}

function formatPersonName(value = '') {
  const trimmed = String(value || '').trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.split(/\s+/).map((part) => {
    if (!part) return '';
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join(' ');
}

function normalizeEmail(value = '') {
  const trimmed = String(value || '').trim().toLowerCase();
  return trimmed;
}

function formatPhoneE164(value = '') {
  if (!value) return '';
  let cleaned = String(value).trim();
  if (!cleaned) return '';
  cleaned = cleaned.replace(/[\s().-]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) {
    return '+' + cleaned.slice(1).replace(/[^0-9]/g, '');
  }
  cleaned = cleaned.replace(/[^0-9]/g, '');
  if (!cleaned) return '';
  if (cleaned.length === 9) {
    return `+48${cleaned}`;
  }
  if (cleaned.length === 11 && cleaned.startsWith('48')) {
    return `+${cleaned}`;
  }
  return `+${cleaned}`;
}

function normalizeWebsite(url = '') {
  let trimmed = String(url || '').trim();
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname !== '/' ? parsed.pathname : ''}`;
  } catch (err) {
    return trimmed;
  }
}

function buildCandidates(primary, extras = [], options = {}) {
  const { normalizer = (val) => (val || '').trim(), kind, sourceLabel } = options;
  const result = [];
  const seen = new Set();
  const pushValue = (input, meta = {}) => {
    if (input === undefined || input === null || input === '') return;
    const entry = typeof input === 'object' && input !== null ? input : { value: input };
    const raw = entry.value ?? entry.email ?? entry.phone ?? entry.url ?? '';
    if (!raw) return;
    const normalized = normalizer(raw);
    if (!normalized) return;
    const candidateKind = entry.kind || meta.kind || kind || 'value';
    const candidateSource = entry.source || meta.source || sourceLabel || 'LLM';
    const key = `${candidateKind}-${normalized.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      value: normalized,
      kind: candidateKind,
      source: candidateSource
    });
  };

  const ensureArray = (value) => {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
  };

  ensureArray(primary).forEach((entry) => pushValue(entry));
  ensureArray(extras).forEach((entry) => pushValue(entry));

  return result;
}

function pickDefaultCandidate(candidates, preferredKind) {
  if (!candidates || !candidates.length) return '';
  if (preferredKind) {
    const preferred = candidates.find((candidate) => candidate.kind === preferredKind);
    if (preferred) return preferred.value;
  }
  return candidates[0].value;
}

function computeAccountCompleteness(account) {
  const fields = ['name', 'nip', 'website', 'billingCity', 'phone'];
  const filled = fields.reduce((count, key) => count + (account[key] ? 1 : 0), 0);
  return fields.length ? filled / fields.length : 0;
}

function computeContactCompleteness(contact) {
  let filled = 0;
  if (contact.firstName) filled += 1;
  if (contact.lastName) filled += 1;
  if (contact.email) filled += 1;
  if (contact.phone || contact.mobile) filled += 1;
  if (contact.contactType) filled += 1;
  return filled / 5;
}

function determineAccountCategory(account) {
  if (account.category && CATEGORY_ORDER.hasOwnProperty(account.category)) {
    return account.category;
  }
  if (account.existsInCrm) {
    if (account.hasNewData || account.needsEnrichment) {
      return 'existing_enrichable';
    }
    return 'existing_complete';
  }
  if (Array.isArray(account.possibleCrmMatches) && account.possibleCrmMatches.length > 0) {
    return 'possible_match';
  }
  const completeness = typeof account.completenessScore === 'number'
    ? account.completenessScore
    : computeAccountCompleteness(account);
  return completeness >= 0.6 ? 'new_complete' : 'new_partial';
}

function determineContactCategory(contact) {
  if (contact.category && CATEGORY_ORDER.hasOwnProperty(contact.category)) {
    return contact.category;
  }
  if (contact.existsInCrm) {
    if (contact.hasNewData || contact.needsEnrichment) {
      return 'existing_enrichable';
    }
    return 'existing_complete';
  }
  const completeness = typeof contact.completenessScore === 'number'
    ? contact.completenessScore
    : computeContactCompleteness(contact);
  return completeness >= 0.8 ? 'new_complete' : 'new_partial';
}

function normalizeAccountData(company = {}, index = 0) {
  const normalizedName = formatCompanyNameUpper(company.company_name || company.name || `Firma ${index + 1}`);
  const friendlyName = formatCompanyNameUpper(company.company_friendly_name || company.friendlyName || '');
  const nip = (company.nip || company.NIP || company.taxId || '').replace(/[^0-9]/g, '');
  const phoneCandidates = buildCandidates(
    company.phone,
    [company.phones, company.phoneCandidates],
    { normalizer: formatPhoneE164, kind: 'phone', sourceLabel: 'phone' }
  );
  const emailCandidates = buildCandidates(
    company.email,
    [company.emails, company.emailCandidates],
    { normalizer: normalizeEmail, kind: 'email', sourceLabel: 'email' }
  );
  const websiteCandidates = buildCandidates(
    company.website,
    [company.websites, company.websiteCandidates],
    { normalizer: normalizeWebsite, kind: 'website', sourceLabel: 'website' }
  );

  const selectedPhone = pickDefaultCandidate(phoneCandidates, 'phone');
  const selectedEmail = pickDefaultCandidate(emailCandidates, 'email');
  const selectedWebsite = pickDefaultCandidate(websiteCandidates, 'website');

  const completenessScore = typeof company.completenessScore === 'number'
    ? company.completenessScore
    : computeAccountCompleteness({
        name: normalizedName,
        nip,
        website: selectedWebsite,
        billingCity: company.billingCity || company.city || '',
        phone: selectedPhone
      });

  const normalizedAccount = {
    id: `account-${index}`,
    name: normalizedName || friendlyName || `Firma ${index + 1}`,
    friendlyName,
    nip,
    billingCity: company.billingCity || company.city || '',
    billingCountry: company.billingCountry || company.country || '',
    matchSource: company.matchSource || company.match_source || company.crmMatchSource || '',
    existsInCrm: Boolean(company.existsInCrm ?? company.exists_in_crm),
    hasNewData: Boolean(company.hasNewData ?? company.has_new_data),
    needsEnrichment: Boolean(company.needsEnrichment ?? company.needs_enrichment),
    completenessScore,
    category: company.category,
    phones: phoneCandidates,
    emails: emailCandidates,
    websites: websiteCandidates,
    crmId: company.crmId || company.crm_id || '',
    possibleCrmMatches: Array.isArray(company.possibleCrmMatches)
      ? company.possibleCrmMatches
      : (Array.isArray(company.possible_matches) ? company.possible_matches : (Array.isArray(company.possibleMatches) ? company.possibleMatches : [])),
    raw: company
  };

  normalizedAccount.category = determineAccountCategory(normalizedAccount);
  normalizedAccount.selectedPhone = selectedPhone;
  normalizedAccount.selectedEmail = selectedEmail;
  normalizedAccount.selectedWebsite = selectedWebsite;

  return normalizedAccount;
}

function normalizeContactData(contact = {}, index = 0) {
  const firstName = formatPersonName(contact.first_name || contact.firstName || '');
  const lastName = formatPersonName(contact.last_name || contact.lastName || '');
  const phoneCandidates = buildCandidates(
    contact.phone,
    [contact.phones, contact.phoneCandidates],
    { normalizer: formatPhoneE164, kind: 'phone', sourceLabel: 'phone' }
  );
  const mobileCandidates = buildCandidates(
    contact.mobile,
    [contact.mobiles, contact.mobileCandidates],
    { normalizer: formatPhoneE164, kind: 'mobile', sourceLabel: 'mobile' }
  );
  const emailCandidates = buildCandidates(
    contact.email,
    [contact.emails, contact.emailCandidates],
    { normalizer: normalizeEmail, kind: 'email', sourceLabel: 'email' }
  );

  const selectedPhone = pickDefaultCandidate(phoneCandidates, 'phone');
  const selectedMobile = pickDefaultCandidate(mobileCandidates, 'mobile');
  const selectedEmail = pickDefaultCandidate(emailCandidates, 'email');

  const contactType = contact.contactType || contact.contact_type || '';

  const completenessScore = typeof contact.completenessScore === 'number'
    ? contact.completenessScore
    : computeContactCompleteness({
        firstName,
        lastName,
        email: selectedEmail,
        phone: selectedPhone,
        mobile: selectedMobile,
        contactType
      });

  const normalizedContact = {
    id: `contact-${index}`,
    firstName,
    lastName,
    // Pola podstawowe
    designation: contact.designation || contact.role || contact.title || '',
    department: contact.department || '',
    companyName: formatCompanyNameUpper(contact.company_name || contact.companyName || ''),
    // Powiązanie z firmą (Account_Name lookup)
    linkedAccountId: contact.linkedAccountId || contact.accountId || contact.account_id || '',
    // Matching
    matchSource: contact.matchSource || contact.match_source || '',
    existsInCrm: Boolean(contact.existsInCrm ?? contact.exists_in_crm),
    hasNewData: Boolean(contact.hasNewData ?? contact.has_new_data),
    needsEnrichment: Boolean(contact.needsEnrichment ?? contact.needs_enrichment),
    // Typ kontaktu (wymagane do zapisu)
    contactType,
    completenessScore,
    category: contact.category,
    // Kandydaci na wartości
    phones: phoneCandidates,
    mobiles: mobileCandidates,
    emails: emailCandidates,
    // CRM ID
    crmId: contact.crmId || contact.crm_id || '',
    // Raw data (do debugowania)
    raw: contact
  };

  normalizedContact.category = determineContactCategory(normalizedContact);
  normalizedContact.selectedPhone = selectedPhone;
  normalizedContact.selectedMobile = selectedMobile;
  normalizedContact.selectedEmail = selectedEmail;

  return normalizedContact;
}

function renderCards(analysis) {
  if (!analysis) {
    resetCardsSection();
    return;
  }

  const accountsSource = analysis.accounts || analysis.companies || [];
  const contactsSource = analysis.contacts || [];

  cardsState.accounts = accountsSource.map((company, idx) => normalizeAccountData(company, idx));
  cardsState.contacts = contactsSource.map((contact, idx) => normalizeContactData(contact, idx));

  renderAccountCards();
  renderContactCards();

  if (cardsSection) {
    const hasData = cardsState.accounts.length || cardsState.contacts.length;
    cardsSection.style.display = hasData ? 'block' : 'none';
  }
}

function renderAccountCards() {
  if (!accountsTab) return;
  accountsTab.innerHTML = '';
  const accounts = [...cardsState.accounts];
  accounts.sort((a, b) => {
    const orderA = CATEGORY_ORDER.hasOwnProperty(a.category) ? CATEGORY_ORDER[a.category] : 99;
    const orderB = CATEGORY_ORDER.hasOwnProperty(b.category) ? CATEGORY_ORDER[b.category] : 99;
    return orderA - orderB;
  });

  if (!accounts.length) {
    accountsTab.appendChild(createEmptyCard('Brak firm w analizie LLM'));
    return;
  }

  accounts.forEach((account) => {
    accountsTab.appendChild(createAccountCard(account));
  });
}

function renderContactCards() {
  if (!contactsTab) return;
  contactsTab.innerHTML = '';
  const contacts = [...cardsState.contacts];
  contacts.sort((a, b) => {
    const orderA = CATEGORY_ORDER.hasOwnProperty(a.category) ? CATEGORY_ORDER[a.category] : 99;
    const orderB = CATEGORY_ORDER.hasOwnProperty(b.category) ? CATEGORY_ORDER[b.category] : 99;
    return orderA - orderB;
  });

  if (!contacts.length) {
    contactsTab.appendChild(createEmptyCard('Brak kontaktów w analizie LLM'));
    return;
  }

  contacts.forEach((contact) => {
    contactsTab.appendChild(createContactCard(contact));
  });
}

function createEmptyCard(text) {
  const card = document.createElement('div');
  card.className = 'contact-card';
  card.textContent = text;
  return card;
}

function createAccountCard(account) {
  const card = document.createElement('div');
  card.className = `contact-card account-card category-${account.category}`;
  card.dataset.accountId = account.id;

  const header = document.createElement('div');
  header.className = 'contact-card-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'contact-card-title-row';

  const title = document.createElement('div');
  title.className = 'contact-card-title';
  title.textContent = account.name || 'Firma bez nazwy';

  const badge = createBadge(account.category);
  titleRow.appendChild(title);
  if (badge) titleRow.appendChild(badge);

  const meta = document.createElement('div');
  meta.className = 'contact-card-meta';
  const metaParts = [];
  metaParts.push(account.existsInCrm ? 'CRM: istnieje' : 'CRM: nowa');
  if (account.matchSource) {
    metaParts.push(`Match: <span class="match-source">${account.matchSource}</span>`);
  }
  if (account.billingCity) {
    metaParts.push(`Miasto: ${account.billingCity}`);
  }
  meta.innerHTML = metaParts.join(' · ');

  header.appendChild(titleRow);
  header.appendChild(meta);
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'contact-card-body';

  // Nazwa firmy (edytowalna)
  body.appendChild(createEditableField('Nazwa firmy (pełna)', account.name, {
    fieldName: 'name',
    accountId: account.id,
    placeholder: 'Wprowadź pełną nazwę firmy'
  }));

  // Nazwa zwyczajowa (edytowalna)
  body.appendChild(createEditableField('Nazwa zwyczajowa', account.friendlyName || '', {
    fieldName: 'friendlyName',
    accountId: account.id,
    placeholder: 'Np. skrócona nazwa'
  }));

  // NIP (edytowalny - kluczowe pole!)
  body.appendChild(createEditableField('NIP', account.nip || '', {
    fieldName: 'nip',
    accountId: account.id,
    placeholder: 'Wprowadź NIP (10 cyfr)',
    inputType: 'text',
    pattern: '[0-9]{10}'
  }));

  // WWW (picker lub edytowalne)
  body.appendChild(renderEditablePicker('WWW', account.websites, {
    preferredKind: 'website',
    preferredValue: account.selectedWebsite,
    hint: 'Wybierz lub wpisz adres strony',
    fieldName: 'website',
    accountId: account.id
  }));

  // Email (picker lub edytowalne)
  body.appendChild(renderEditablePicker('Email', account.emails, {
    preferredKind: 'email',
    preferredValue: account.selectedEmail,
    hint: 'Dostępne adresy e-mail',
    fieldName: 'email',
    accountId: account.id
  }));

  // Telefon (picker lub edytowalne)
  body.appendChild(renderEditablePicker('Telefon', account.phones, {
    preferredKind: 'phone',
    preferredValue: account.selectedPhone,
    hint: 'Numery znalezione w wiadomości',
    fieldName: 'phone',
    accountId: account.id
  }));

  // Miasto (edytowalne)
  body.appendChild(createEditableField('Miasto', account.billingCity || '', {
    fieldName: 'billingCity',
    accountId: account.id,
    placeholder: 'Miasto siedziby'
  }));

  card.appendChild(body);
  card.appendChild(createCardActions(account, 'account'));

  return card;
}

// Opcje dla pola "Typ kontaktu" (hardcoded wg API_POLA_KONTAKTY.md)
const CONTACT_TYPE_OPTIONS = [
  { value: '', label: '-- Wybierz typ --' },
  { value: 'Pracownik medyczny', label: 'Pracownik medyczny' },
  { value: 'Pracownik firmy', label: 'Pracownik firmy' },
  { value: 'Pracownik stowarzyszeń i inne', label: 'Pracownik stowarzyszeń i inne' },
  { value: 'Pracownik usługodawcy/dostawcy', label: 'Pracownik usługodawcy/dostawcy' }
];

function createContactCard(contact) {
  const card = document.createElement('div');
  card.className = `contact-card contact-entry category-${contact.category}`;
  card.dataset.contactId = contact.id;

  const header = document.createElement('div');
  header.className = 'contact-card-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'contact-card-title-row';

  const title = document.createElement('div');
  title.className = 'contact-card-title';
  title.textContent = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Kontakt bez nazwy';

  const badge = createBadge(contact.category);
  titleRow.appendChild(title);
  if (badge) titleRow.appendChild(badge);

  const meta = document.createElement('div');
  meta.className = 'contact-card-meta';
  const metaParts = [];
  metaParts.push(contact.existsInCrm ? 'CRM: istnieje' : 'CRM: nowy');
  if (contact.matchSource) {
    metaParts.push(`Match: <span class="match-source">${contact.matchSource}</span>`);
  }
  if (contact.companyName) {
    metaParts.push(`Firma: ${contact.companyName}`);
  }
  meta.innerHTML = metaParts.join(' · ');

  header.appendChild(titleRow);
  header.appendChild(meta);
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'contact-card-body';

  // ========== A. Pola podstawowe (zawsze widoczne) ==========

  // Imię (edytowalne, wymagane)
  body.appendChild(createEditableField('Imię', contact.firstName || '', {
    fieldName: 'firstName',
    contactId: contact.id,
    placeholder: 'Wprowadź imię',
    required: true
  }));

  // Nazwisko (edytowalne, wymagane)
  body.appendChild(createEditableField('Nazwisko', contact.lastName || '', {
    fieldName: 'lastName',
    contactId: contact.id,
    placeholder: 'Wprowadź nazwisko',
    required: true
  }));

  // Email (picker lub edytowalne)
  body.appendChild(renderEditablePicker('Email', contact.emails, {
    preferredKind: 'email',
    preferredValue: contact.selectedEmail,
    hint: 'Adresy e-mail znalezione w wiadomości',
    fieldName: 'email',
    contactId: contact.id
  }));

  // Telefon firmowy (picker lub edytowalne)
  body.appendChild(renderEditablePicker('Telefon firmowy', contact.phones, {
    preferredKind: 'phone',
    preferredValue: contact.selectedPhone,
    hint: 'Numery przypisane do kontaktu',
    fieldName: 'phone',
    contactId: contact.id
  }));

  // Telefon komórkowy (picker lub edytowalne)
  body.appendChild(renderEditablePicker('Telefon komórkowy', contact.mobiles, {
    preferredKind: 'mobile',
    preferredValue: contact.selectedMobile,
    hint: 'Numery komórkowe (jeśli znaleziono)',
    fieldName: 'mobile',
    contactId: contact.id
  }));

  // Stanowisko (edytowalne)
  body.appendChild(createEditableField('Stanowisko', contact.designation || '', {
    fieldName: 'designation',
    contactId: contact.id,
    placeholder: 'Np. Dyrektor, Manager'
  }));

  // Dział (edytowalne)
  body.appendChild(createEditableField('Dział', contact.department || '', {
    fieldName: 'department',
    contactId: contact.id,
    placeholder: 'Np. Sprzedaż, Marketing'
  }));

  // ========== B. Pole typu kontaktu (wymagane do zapisu) ==========
  body.appendChild(createSelectField('Typ kontaktu', contact.contactType || '', {
    fieldName: 'contactType',
    contactId: contact.id,
    options: CONTACT_TYPE_OPTIONS,
    required: true
  }));

  // ========== F. Pole relacyjne - powiązanie z firmą ==========
  body.appendChild(createAccountLinkField(contact));

  card.appendChild(body);
  card.appendChild(createCardActions(contact, 'contact'));

  return card;
}

function createBadge(category) {
  if (!category) return null;
  const config = CATEGORY_BADGES[category];
  const badge = document.createElement('span');
  badge.className = `contact-status-badge ${config?.className || ''}`;
  badge.textContent = config?.label || category;
  return badge;
}

function createCardField(labelText, valueText) {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  wrapper.appendChild(label);
  const value = document.createElement('div');
  value.className = valueText ? 'value' : 'no-data';
  value.textContent = valueText || 'Brak danych';
  wrapper.appendChild(value);
  return wrapper;
}

// Edytowalne pole tekstowe
function createEditableField(labelText, initialValue, options = {}) {
  const { fieldName, contactId, accountId, placeholder, required, inputType, pattern } = options;
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';
  
  const label = document.createElement('label');
  label.textContent = labelText + (required ? ' *' : '');
  wrapper.appendChild(label);
  
  const input = document.createElement('input');
  input.type = inputType || 'text';
  input.value = initialValue || '';
  input.placeholder = placeholder || '';
  if (pattern) input.pattern = pattern;
  if (required) input.required = true;
  
  // Data attributes do identyfikacji pola
  if (contactId) input.dataset.contactId = contactId;
  if (accountId) input.dataset.accountId = accountId;
  if (fieldName) input.dataset.field = fieldName;
  
  input.addEventListener('input', () => {
    console.log(`[Sidepanel] Field change: ${fieldName} = "${input.value}"`);
    // Aktualizuj stan w cardsState
    updateCardFieldValue(contactId || accountId, fieldName, input.value, contactId ? 'contact' : 'account');
  });
  
  wrapper.appendChild(input);
  return wrapper;
}

// Select field (dropdown)
function createSelectField(labelText, initialValue, options = {}) {
  const { fieldName, contactId, accountId, options: selectOptions, required } = options;
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';
  
  const label = document.createElement('label');
  label.textContent = labelText + (required ? ' *' : '');
  wrapper.appendChild(label);
  
  const select = document.createElement('select');
  if (contactId) select.dataset.contactId = contactId;
  if (accountId) select.dataset.accountId = accountId;
  if (fieldName) select.dataset.field = fieldName;
  if (required) select.required = true;
  
  (selectOptions || []).forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === initialValue) option.selected = true;
    select.appendChild(option);
  });
  
  select.addEventListener('change', () => {
    console.log(`[Sidepanel] Select change: ${fieldName} = "${select.value}"`);
    updateCardFieldValue(contactId || accountId, fieldName, select.value, contactId ? 'contact' : 'account');
  });
  
  wrapper.appendChild(select);
  return wrapper;
}

// Picker z możliwością edycji (select + input)
function renderEditablePicker(labelText, candidates = [], options = {}) {
  const { preferredKind, preferredValue, hint, fieldName, contactId, accountId } = options;
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';
  
  const label = document.createElement('label');
  label.textContent = labelText;
  wrapper.appendChild(label);

  const pickerWrapper = document.createElement('div');
  pickerWrapper.className = 'input-with-picker';

  // Jeśli są kandydaci, pokaż select + input
  if (candidates && candidates.length > 0) {
    const select = document.createElement('select');
    select.className = 'picker-select';
    
    // Opcja "Wpisz własną wartość"
    const customOption = document.createElement('option');
    customOption.value = '__custom__';
    customOption.textContent = '✏️ Wpisz własną wartość...';
    select.appendChild(customOption);
    
    candidates.forEach((candidate) => {
      const option = document.createElement('option');
      option.value = candidate.value;
      option.textContent = candidate.value;
      option.dataset.kind = candidate.kind || '';
      select.appendChild(option);
    });

    const defaultValue = preferredValue || pickDefaultCandidate(candidates, preferredKind);
    if (defaultValue) {
      select.value = defaultValue;
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'picker-custom-input';
    input.placeholder = 'Wpisz wartość...';
    input.style.display = select.value === '__custom__' ? 'block' : 'none';
    input.value = select.value === '__custom__' ? '' : '';
    
    if (contactId) {
      select.dataset.contactId = contactId;
      input.dataset.contactId = contactId;
    }
    if (accountId) {
      select.dataset.accountId = accountId;
      input.dataset.accountId = accountId;
    }
    if (fieldName) {
      select.dataset.field = fieldName;
      input.dataset.field = fieldName;
    }

    select.addEventListener('change', () => {
      if (select.value === '__custom__') {
        input.style.display = 'block';
        input.focus();
      } else {
        input.style.display = 'none';
        console.log(`[Sidepanel] Picker select: ${fieldName} = "${select.value}"`);
        updateCardFieldValue(contactId || accountId, fieldName, select.value, contactId ? 'contact' : 'account');
      }
    });
    
    input.addEventListener('input', () => {
      console.log(`[Sidepanel] Picker input: ${fieldName} = "${input.value}"`);
      updateCardFieldValue(contactId || accountId, fieldName, input.value, contactId ? 'contact' : 'account');
    });

    pickerWrapper.appendChild(select);
    pickerWrapper.appendChild(input);
  } else {
    // Brak kandydatów - tylko input
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Wprowadź wartość...';
    input.value = preferredValue || '';
    
    if (contactId) input.dataset.contactId = contactId;
    if (accountId) input.dataset.accountId = accountId;
    if (fieldName) input.dataset.field = fieldName;
    
    input.addEventListener('input', () => {
      console.log(`[Sidepanel] Field input: ${fieldName} = "${input.value}"`);
      updateCardFieldValue(contactId || accountId, fieldName, input.value, contactId ? 'contact' : 'account');
    });
    
    pickerWrapper.appendChild(input);
  }

  if (hint) {
    const sourceInfo = document.createElement('div');
    sourceInfo.className = 'picker-meta';
    sourceInfo.textContent = hint;
    pickerWrapper.appendChild(sourceInfo);
  }

  wrapper.appendChild(pickerWrapper);
  return wrapper;
}

// Pole powiązania z firmą (Account_Name lookup)
function createAccountLinkField(contact) {
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field account-link-field';
  
  const label = document.createElement('label');
  label.textContent = 'Powiązana firma';
  wrapper.appendChild(label);
  
  const linkWrapper = document.createElement('div');
  linkWrapper.className = 'account-link-wrapper';
  
  // Wyświetl aktualnie powiązaną firmę (jeśli jest)
  const linkedAccountDisplay = document.createElement('div');
  linkedAccountDisplay.className = 'linked-account-display';
  
  if (contact.linkedAccountId || contact.accountId) {
    linkedAccountDisplay.innerHTML = `<span class="linked-account-name">${contact.companyName || 'Firma powiązana'}</span> <span class="linked-account-id">(${contact.linkedAccountId || contact.accountId})</span>`;
  } else if (contact.companyName) {
    linkedAccountDisplay.innerHTML = `<span class="linked-account-name">${contact.companyName}</span> <span class="no-link">(nie powiązano)</span>`;
  } else {
    linkedAccountDisplay.innerHTML = '<span class="no-data">Brak powiązanej firmy</span>';
  }
  
  linkWrapper.appendChild(linkedAccountDisplay);
  
  // Przycisk do wyszukiwania firmy (TODO: implementacja search-accounts)
  const searchBtn = document.createElement('button');
  searchBtn.type = 'button';
  searchBtn.className = 'btn btn-small';
  searchBtn.textContent = '🔍 Szukaj firmy';
  searchBtn.style.marginTop = '4px';
  searchBtn.style.fontSize = '11px';
  searchBtn.style.padding = '4px 8px';
  searchBtn.addEventListener('click', () => {
    console.log('[Sidepanel] Kliknięto "Szukaj firmy" dla kontaktu:', contact.id);
    // TODO: Implementacja wyszukiwania firm (search-accounts)
    alert('Funkcja wyszukiwania firm zostanie zaimplementowana w kolejnym etapie.');
  });
  
  linkWrapper.appendChild(searchBtn);
  wrapper.appendChild(linkWrapper);
  
  return wrapper;
}

// Aktualizacja wartości pola w cardsState
function updateCardFieldValue(itemId, fieldName, value, type) {
  if (!itemId || !fieldName) return;
  
  const collection = type === 'contact' ? cardsState.contacts : cardsState.accounts;
  const item = collection.find((i) => i.id === itemId);
  
  if (item) {
    item[fieldName] = value;
    console.log(`[Sidepanel] Updated ${type} ${itemId}.${fieldName} = "${value}"`);
  }
}

function renderPicker(labelText, candidates = [], options = {}) {
  const { preferredKind, preferredValue, hint } = options;
  const wrapper = document.createElement('div');
  wrapper.className = 'form-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  wrapper.appendChild(label);

  if (!candidates.length) {
    const empty = document.createElement('div');
    empty.className = 'no-data';
    empty.textContent = 'Brak danych';
    wrapper.appendChild(empty);
    return wrapper;
  }

  const pickerWrapper = document.createElement('div');
  pickerWrapper.className = 'input-with-picker';

  const select = document.createElement('select');
  candidates.forEach((candidate) => {
    const option = document.createElement('option');
    option.value = candidate.value;
    option.textContent = candidate.value;
    option.dataset.kind = candidate.kind || '';
    select.appendChild(option);
  });

  const defaultValue = preferredValue || pickDefaultCandidate(candidates, preferredKind);
  if (defaultValue) {
    select.value = defaultValue;
  }

  select.addEventListener('change', () => {
    console.log('[Sidepanel] Picker change', labelText, select.value);
  });

  pickerWrapper.appendChild(select);

  const sourceInfo = document.createElement('div');
  sourceInfo.className = 'picker-meta';
  sourceInfo.textContent = hint || `Źródła: ${candidates.map((c) => c.source || c.kind || 'kandydat').join(', ')}`;
  pickerWrapper.appendChild(sourceInfo);

  wrapper.appendChild(pickerWrapper);

  return wrapper;
}

function createCardActions(item, type) {
  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const createBtn = document.createElement('button');
  createBtn.className = 'btn btn-primary';
  createBtn.type = 'button';
  createBtn.textContent = 'Utwórz';
  createBtn.addEventListener('click', () => {
    console.log(`[Sidepanel] Kliknięto "Utwórz" (${type})`, item);
  });

  const updateBtn = document.createElement('button');
  updateBtn.className = 'btn btn-success';
  updateBtn.type = 'button';
  updateBtn.textContent = 'Aktualizuj';
  updateBtn.addEventListener('click', () => {
    console.log(`[Sidepanel] Kliknięto "Aktualizuj" (${type})`, item);
  });

  actions.appendChild(createBtn);
  actions.appendChild(updateBtn);
  return actions;
}

// ETAP 2*: Message ID i Thread ID = tylko wyświetlanie (NIE przyciski)
// AUTO-FETCH pobiera pełną wiadomość automatycznie

// ETAP 4: Obsługa przycisku "Analizuj LLM"
if (analyzeLLMBtn) {
  analyzeLLMBtn.addEventListener('click', () => {
    console.log('[Sidepanel] 🤖 CLICK na przycisk Analizuj LLM');
    
    if (!currentState || !currentState.messageId) {
      console.log('[Sidepanel] ⚠️ Brak messageId do analizy');
      return;
    }

    // Jeśli analiza już istnieje, wyświetl ją
    if (llmState.hasAnalysis && llmState.analysisData) {
      console.log('[Sidepanel] 💾 Analiza już istnieje - wyświetlam z cache');
      displayAnalysisData(llmState.analysisData);
      setDataSourceLabel('cache');
      return;
    }

    // Uruchom analizę
    console.log('[Sidepanel] 🚀 Uruchamiam analizę LLM:', currentState.messageId);
    llmState.isAnalyzing = true;
    
    chrome.runtime.sendMessage({
      type: 'analyze-message',
      messageId: currentState.messageId,
      threadId: currentState.threadId
    }).then(response => {
      console.log('[Sidepanel] ✅ Odpowiedź z background (analyze-message):', response);
    }).catch(err => {
      console.log('[Sidepanel] ❌ Błąd wysyłania analyze-message:', err.message);
      llmState.isAnalyzing = false;
    });

    // Wizualna informacja
    analysisSection.style.display = 'block';
    analysisData.textContent = '⏳ Analizuję wiadomość za pomocą LLM...';
    if (dataSourceLabel) dataSourceLabel.style.display = 'none';
  });
}

// Obsługa przycisku "Wyczyść cache"
if (clearCacheBtn) {
  clearCacheBtn.addEventListener('click', () => {
    console.log('[Sidepanel] 🗑️ CLICK na przycisk Wyczyść cache');
    
    // Wyślij żądanie do background.js
    chrome.runtime.sendMessage({
      type: 'clear-cache'
    }).then(response => {
      if (response && response.success) {
        console.log('[Sidepanel] ✅ Cache wyczyszczony');
        
        // Reset lokalnego stanu
        resetFetchedData();
        resetThreadState();
        resetAnalysisData();
        
        // Wizualna informacja
        alert('✅ Cache wtyczki został wyczyszczony.\n\nPrzeładuj stronę Gmail i otwórz ponownie wiadomość, aby pobrać świeże dane.');
      } else {
        console.log('[Sidepanel] ❌ Błąd czyszczenia cache:', response?.error);
        alert('❌ Nie udało się wyczyścić cache: ' + (response?.error || 'Nieznany błąd'));
      }
    }).catch(err => {
      console.log('[Sidepanel] ❌ Błąd wysyłania clear-cache:', err.message);
      alert('❌ Błąd komunikacji: ' + err.message);
    });
  });
  console.log('[Sidepanel] ✅ Click listener dodany do przycisku Wyczyść cache');
}

// ETAP 2*: Obsługa przycisku "Pobierz cały wątek" + Thread Intelligence
if (fetchThreadBtn) {
  fetchThreadBtn.addEventListener('click', () => {
    console.log('[Sidepanel] 🧵 CLICK na przycisk Pobierz wątek');
    
    if (!currentState || !currentState.threadId) {
      console.log('[Sidepanel] ⚠️ Brak threadId do pobrania');
      return;
    }

    // Thread Intelligence: Sprawdź cache
    if (threadState.threadFullLoaded && threadState.cachedThreads[currentState.threadId]) {
      console.log('[Sidepanel] 💾 Wątek już pobrany - wyświetlam z cache');
      displayFetchedData(threadState.cachedThreads[currentState.threadId], 'thread');
      return;
    }

    // Thread Intelligence: Sprawdź messageCount
    if (threadState.threadMetadataLoaded && threadState.messageCount === 1) {
      console.log('[Sidepanel] ℹ️ Ten wątek ma tylko 1 wiadomość - pełny widok nie jest potrzebny');
      fetchedDataSection.style.display = 'block';
      fetchedData.textContent = 'ℹ️ Ten wątek zawiera tylko jedną wiadomość.\n\nPełna treść jest już wyświetlona powyżej (AUTO-FETCH).\nPobieranie całego wątku nie wniesie dodatkowych danych.';
      return;
    }

    console.log('[Sidepanel] 🚀 Pobieranie pełnego wątku:', currentState.threadId, 'messageCount:', threadState.messageCount);
    
    chrome.runtime.sendMessage({
      type: 'manual-fetch-thread',
      threadId: currentState.threadId,
      messageId: currentState.messageId
    }).then(response => {
      console.log('[Sidepanel] ✅ Odpowiedź z background (manual-fetch-thread):', response);
    }).catch(err => {
      console.log('[Sidepanel] ❌ Błąd wysyłania manual-fetch-thread:', err.message);
    });

    // Wizualna informacja
    if (fetchedData) {
      fetchedData.textContent = '⏳ Pobieranie pełnego wątku...';
    }
    if (fetchedDataSection) {
      fetchedDataSection.style.display = 'block';
    }
  });
  console.log('[Sidepanel] ✅ Click listener dodany do przycisku Pobierz wątek');
} else {
  console.error('[Sidepanel] ❌ fetchThreadBtn nie znaleziony!');
}

// Nasłuchuj na wiadomości od background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ETAP 1: Update stanu Gmaila
  if (message.type === 'state-update') {
    console.log('[Sidepanel] Otrzymano update stanu:', message.data);
    updateUI(message.data);
  }

  // ETAP 2*: Auto-fetch (pełna wiadomość)
  if (message.type === 'auto-mail-data') {
    // Nie loguj pełnej wiadomości (plainBody/htmlBody potrafią być ogromne)
    console.log('[Sidepanel] Otrzymano auto-fetch FULL data:', {
      success: Boolean(message?.data?.success),
      messageId: message?.data?.messageId || '-',
      threadId: message?.data?.threadId || '-',
      subject: message?.data?.subject || '-',
      plainChars: message?.data?.plainBody ? message.data.plainBody.length : 0,
      htmlChars: message?.data?.htmlBody ? message.data.htmlBody.length : 0,
      attachments: Array.isArray(message?.data?.attachments) ? message.data.attachments.length : 0
    });
    threadState.messageMetadataLoaded = true;
    threadState.currentView = 'auto';
    displayFetchedData(message.data, 'message');
  }

  // ETAP 2*: Thread Intelligence - metadata (messageCount)
  if (message.type === 'thread-metadata') {
    console.log('[Sidepanel] 🧠 Otrzymano thread metadata:', message.data);
    threadState.threadMetadataLoaded = true;
    threadState.messageCount = message.data.messageCount || 0;
    threadState.hasFullThreadFetchedBefore = !!message.data.wasFullThreadFetched;
    
    // Zaktualizuj tekst przycisku (kompaktowy)
    if (fetchThreadBtn && message.data.messageCount > 1) {
      fetchThreadBtn.textContent = `🧵 Wątek (${message.data.messageCount})`;
      fetchThreadBtn.title = threadState.hasFullThreadFetchedBefore 
        ? `Pobierz cały wątek (${message.data.messageCount} wiadomości) - już kiedyś pobrany`
        : `Pobierz cały wątek (${message.data.messageCount} wiadomości)`;
      fetchThreadBtn.disabled = false;
    } else if (fetchThreadBtn && message.data.messageCount === 1) {
      fetchThreadBtn.textContent = `🧵 1 msg`;
      fetchThreadBtn.title = 'Wątek ma tylko 1 wiadomość';
      fetchThreadBtn.disabled = true;
    }
  }

  // ETAP 2*: Manual thread fetch (pełny wątek) - jedyny manual fetch
  if (message.type === 'full-thread-ready') {
    // Nie loguj pełnego wątku (dużo danych); tylko podsumowanie
    console.log('[Sidepanel] Otrzymano full-thread-ready:', {
      success: Boolean(message?.data?.success),
      threadId: message?.data?.threadId || '-',
      messageCount: message?.data?.messageCount || 0
    });
    threadState.threadFullLoaded = true;
    threadState.currentView = 'thread';
    
    // Cache thread data
    if (currentState?.threadId) {
      threadState.cachedThreads[currentState.threadId] = message.data;
      console.log('[Sidepanel] 💾 Wątek zapisany w cache:', currentState.threadId);
    }
    
    // Zaktualizuj przycisk - pokaż że wątek jest już pobrany (kompaktowy)
    if (fetchThreadBtn) {
      fetchThreadBtn.textContent = `✅ Wątek (${message.data.messageCount || 0})`;
      fetchThreadBtn.title = `Cały wątek pobrany (${message.data.messageCount || 0} wiadomości)`;
      fetchThreadBtn.disabled = true;
    }
    
    displayFetchedData(message.data, 'thread');
  }

  // ETAP 4: Analiza LLM gotowa
  if (message.type === 'analysis-ready') {
    console.log('[Sidepanel] 🤖 Otrzymano analysis-ready:', message.data);
    llmState.hasAnalysis = true;
    llmState.analysisData = message.data;
    llmState.isAnalyzing = false;
    
    // Zaktualizuj przycisk - pokaż że analiza jest dostępna (kompaktowy)
    if (analyzeLLMBtn) {
      analyzeLLMBtn.textContent = '🤖 Zobacz';
      analyzeLLMBtn.title = 'Zobacz analizę LLM';
    }
    
    // Dodaj ✓ przy messageId (kompaktowy)
    if (currentState?.messageId && messageIdElement) {
      const shortMsgId = currentState.messageId.length > 8 ? currentState.messageId.slice(0, 8) + '…' : currentState.messageId;
      messageIdElement.innerHTML = `${shortMsgId}<span class="has-analysis-check">✓</span>`;
      messageIdElement.title = currentState.messageId + ' (analiza dostępna)';
    }
    
    // Ustaw etykietę źródła danych
    if (message.fromCache) {
      setDataSourceLabel('cache');
    } else if (message.metadata?.cached) {
      setDataSourceLabel('firestore');
    } else {
      setDataSourceLabel('fresh');
    }
    
    displayAnalysisData(message.data);
    renderCards(message.data);
  }

  // ETAP 4: Błąd analizy LLM
  if (message.type === 'analysis-error') {
    console.log('[Sidepanel] ❌ Błąd analizy LLM:', message.error);
    llmState.isAnalyzing = false;
    
    analysisSection.style.display = 'block';
    analysisData.textContent = `❌ Błąd analizy LLM:\n\n${message.error}`;
    
    if (analyzeLLMBtn) {
      analyzeLLMBtn.textContent = '🤖 Ponów';
      analyzeLLMBtn.title = 'Analizuj LLM (ponów)';
    }
    resetCardsSection();
  }
  
  // Nie zwracamy true - wszystkie operacje są synchroniczne
  return false;
});

// Przy uruchomieniu sidepanel, zapytaj background.js o aktualny stan
chrome.runtime.sendMessage({
  type: 'get-current-state'
}).then(response => {
  console.log('[Sidepanel] Pobrano aktualny stan:', response);
  updateUI(response);
}).catch(err => {
  console.log('[Sidepanel] Błąd pobierania stanu:', err.message);
});

console.log('[Sidepanel] Zainicjalizowano (ETAP 2*: Auto-Full + Manual-Thread)');
sidepanelLogger.info('Sidepanel zainicjalizowano (ETAP 2*: Auto-Full + Manual-Thread)');
