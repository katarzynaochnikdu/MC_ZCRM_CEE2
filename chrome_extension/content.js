// Content script - system wykrywania stanów Gmaila (ETAP 1)

// Definicje stanów
const STAN_LOADING = 'loading';
const STAN_INBOX_LIST = 'inbox_list';
const STAN_MAIL_OPENED = 'mail_opened';
const STAN_MAIL_CHANGED = 'mail_changed';
const STAN_THREAD_VIEW = 'thread_view';

// Stan poprzedni (do wykrywania zmian)
let previousState = null;
let previousMessageId = null;
let previousThreadId = null;

// Gdy rozszerzenie zostanie przeładowane/zaktualizowane, kontekst content script może zostać unieważniony.
// Wtedy każde chrome.runtime.sendMessage potrafi rzucać synchronicznie "Extension context invalidated".
// Żeby nie zabić wykrywania stanów, odłączamy obserwery i przestajemy emitować zdarzenia.
let detectorsDisabled = false;
let gmailDomObserver = null;
let backupIntervalId = null;

function disableDetectors(reason, err) {
  if (detectorsDisabled) return;
  detectorsDisabled = true;

  try {
    if (gmailDomObserver) gmailDomObserver.disconnect();
  } catch (_) {}

  try {
    if (backupIntervalId) clearInterval(backupIntervalId);
  } catch (_) {}

  console.warn('[Content Script] Detektory wyłączone:', reason, err ? String(err) : '');
}

// Funkcja wykrywająca czy Gmail się ładuje
function isGmailLoading() {
  // Sprawdź czy jest loader/spinner
  const loadingIndicators = [
    '[role="progressbar"]',
    '.loading',
    '[aria-busy="true"]',
    'div[data-loading="true"]'
  ];
  
  for (const selector of loadingIndicators) {
    if (document.querySelector(selector)) {
      return true;
    }
  }
  
  // Sprawdź czy główny kontener jest pusty (może się jeszcze ładować)
  const mainContainer = document.querySelector('div[role="main"]');
  if (!mainContainer || mainContainer.children.length === 0) {
    return true;
  }
  
  return false;
}

// Funkcja pobierająca threadId z URL
function getThreadIdFromHash() {
  // Gmail potrafi zmieniać format nawigacji (czasem samo "#inbox", czasem "#inbox/<threadId>").
  // Najstabilniej parsować z pełnego href, a hash traktować jako fallback.
  const href = window.location.href || '';
  const hash = window.location.hash || '';

  // Najczęstszy format: ...#inbox/<threadId> albo ...#label/.../<threadId>
  // Uwaga: czasem po threadId w hash są parametry (np. ?compose=...) – więc pozwalamy na ogon.
  const fromHref = href.match(/#(?:[^/]+\/)*([a-zA-Z0-9_-]{10,})(?:[/?].*)?$/);
  if (fromHref && fromHref[1]) return fromHref[1];

  const fromHash = hash.match(/\/([a-zA-Z0-9_-]{10,})(?:[/?].*)?$/);
  if (fromHash && fromHash[1]) return fromHash[1];

  // Fallback: w liście maili zaznaczony element często ma link z /<threadId>
  // Uwaga: `[aria-selected="true"]` w Gmailu często wskazuje na zakładki (np. "Główne", role="tab"),
  // nie na wiersz maila. Dlatego filtrujemy po roli i szukamy elementu, który zawiera link z hash.
  const selectedCandidates = Array.from(document.querySelectorAll('[aria-selected="true"]'));
  for (const el of selectedCandidates) {
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'tab') continue;

    const link = el.matches('a[href*="#"]') ? el : el.querySelector('a[href*="#"]');
    if (!link) continue;

    const hrefAttr = link.getAttribute('href') || '';
    const m = hrefAttr.match(/#(?:[^/]+\/)*([a-zA-Z0-9_-]{10,})(?:[/?].*)?$/);
    if (m && m[1]) return m[1];
  }

  // Dodatkowy fallback: czasem zaznaczenie jest na wierszu tabeli (role="row") w `div[role="main"]`.
  const selectedRowInMain = document.querySelector('div[role="main"] [role="row"][aria-selected="true"] a[href*="#"]')
    || document.querySelector('div[role="main"] tr[aria-selected="true"] a[href*="#"]');
  if (selectedRowInMain) {
    const hrefAttr = selectedRowInMain.getAttribute('href') || '';
    const m = hrefAttr.match(/#(?:[^/]+\/)*([a-zA-Z0-9_-]{10,})(?:[/?].*)?$/);
    if (m && m[1]) return m[1];
  }

  return null;
}

// Funkcja pobierająca messageId z DOM
function getMessageIdFromDom() {
  // Gmail potrafi osadzić data-message-id na różnych elementach (nie zawsze div),
  // a czasem atrybut istnieje, ale jest pusty. Szukamy pierwszej NIEPUSTEJ wartości.
  const root = document.querySelector('div[role="main"]');
  if (!root) return null;

  const nodes = root.querySelectorAll('[data-legacy-message-id], [data-message-id]');
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const legacy = node.getAttribute('data-legacy-message-id');
    const mid = node.getAttribute('data-message-id');
    const value = (legacy && legacy.trim()) || (mid && mid.trim()) || '';
    if (value) return value;
  }

  return null;
}

// Funkcja sprawdzająca czy jesteśmy w widoku wątku
function isThreadView() {
  const threadId = getThreadIdFromHash();
  if (!threadId) return false;
  
  // Sprawdź czy są widoczne wątki (wiele maili w jednym wątku)
  const threadMessages = document.querySelectorAll('div[role="main"] div[data-message-id], div[role="main"] div[data-legacy-message-id]');
  return threadMessages.length > 1;
}

// Główna funkcja wykrywania stanu
function detectGmailState() {
  // Sprawdź czy jesteśmy w Gmail
  if (!window.location.hostname.includes('mail.google.com')) {
    return null;
  }

  const threadId = getThreadIdFromHash();
  const messageId = getMessageIdFromDom();

  // STAN 1: Ładowanie
  // Gmail często ma elementy "loading" stale w DOM. Nie chcemy blokować detekcji maila,
  // jeśli mamy już threadId lub messageId.
  if (isGmailLoading() && !threadId && !messageId) {
    return {
      stan: STAN_LOADING,
      timestamp: Date.now()
    };
  }

  // STAN 2: Lista inbox (brak otwartego maila)
  // Jeśli threadId jest, ale messageId jeszcze nie, to Gmail jest w trakcie renderu -> loading.
  if (threadId && !messageId) {
    return {
      stan: STAN_LOADING,
      threadId: threadId,
      messageId: null,
      timestamp: Date.now()
    };
  }

  if (!threadId) {
    return {
      stan: STAN_INBOX_LIST,
      threadId: null,
      messageId: null,
      timestamp: Date.now()
    };
  }

  // STAN 5: Widok wątku (wiele maili)
  if (isThreadView()) {
    return {
      stan: STAN_THREAD_VIEW,
      threadId: threadId,
      messageId: messageId,
      timestamp: Date.now()
    };
  }

  // STAN 3 lub 4: Mail otwarty lub zmiana maila
  const isMailChanged = previousMessageId !== null && 
                        previousMessageId !== messageId;
  
  return {
    stan: isMailChanged ? STAN_MAIL_CHANGED : STAN_MAIL_OPENED,
    threadId: threadId,
    messageId: messageId,
    timestamp: Date.now()
  };
}

// Funkcja wysyłająca stan do background.js
function sendStateToBackground(state) {
  if (!state) return;

  if (detectorsDisabled) return;

  try {
    if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      disableDetectors('chrome.runtime.sendMessage niedostępne');
      return;
    }

    const p = chrome.runtime.sendMessage({
      type: 'gmail-state-changed',
      data: state
    });

    // MV3 zwykle zwraca Promise, ale w razie innego środowiska zabezpieczamy się.
    if (p && typeof p.catch === 'function') {
      p.catch(err => {
        const msg = err && (err.message || String(err));
        if (msg && msg.includes('Extension context invalidated')) {
          disableDetectors('Extension context invalidated', err);
          return;
        }
        console.error('[Content Script] Błąd wysyłania stanu:', err);
      });
    }
  } catch (err) {
    const msg = err && (err.message || String(err));
    if (msg && msg.includes('Extension context invalidated')) {
      disableDetectors('Extension context invalidated', err);
      return;
    }
    console.error('[Content Script] Błąd wysyłania stanu (sync):', err);
  }
  
  console.log('[Content Script] Stan wykryty:', state);
  if (contentLogger) {
    contentLogger.info(`Stan wykryty: ${state.stan}`, {
      messageId: state.messageId,
      threadId: state.threadId
    });
  }
}

// Funkcja sprawdzająca i notyfikująca o zmianie stanu
function checkAndNotifyState() {
  if (detectorsDisabled) return;
  const currentState = detectGmailState();
  
  if (!currentState) {
    return; // Nie jesteśmy w Gmail
  }

  // Sprawdź czy stan się zmienił
  const stateChanged = !previousState || 
                       previousState.stan !== currentState.stan ||
                       previousState.messageId !== currentState.messageId ||
                       previousState.threadId !== currentState.threadId;

  if (stateChanged) {
    // Zapisz poprzedni stan
    previousState = { ...currentState };
    previousMessageId = currentState.messageId;
    previousThreadId = currentState.threadId;
    
    // Wyślij nowy stan
    sendStateToBackground(currentState);
  }
}

// Obserwuj zmiany w URL (Gmail używa hash routing)
function observeUrlChanges() {
  let currentUrl = window.location.href;
  
  // Nasłuchuj na zmiany hash
  window.addEventListener('hashchange', () => {
    setTimeout(checkAndNotifyState, 100); // Małe opóźnienie dla renderowania
  });

  // Obserwuj zmiany DOM (Gmail dynamicznie zmienia zawartość)
  if (gmailDomObserver) return; // już zainicjalizowane

  gmailDomObserver = new MutationObserver(() => {
    if (currentUrl !== window.location.href) {
      currentUrl = window.location.href;
      setTimeout(checkAndNotifyState, 100);
    } else {
      // Sprawdź też zmiany w DOM (może się zmienić messageId bez zmiany URL)
      checkAndNotifyState();
    }
  });

  gmailDomObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-message-id', 'data-legacy-message-id']
  });
}

// Inicjalizacja loggera
let contentLogger = null;
if (typeof Logger !== 'undefined') {
  contentLogger = new Logger('ContentScript');
  contentLogger.captureConsole(); // Przechwytuj wszystko z konsoli
  if (!window.loggers) window.loggers = [];
  window.loggers.push(contentLogger);
}

// Inicjalizacja
console.log('[Content Script] System stanów Gmaila uruchomiony (ETAP 1)');
if (contentLogger) {
  contentLogger.info('System stanów Gmaila uruchomiony (ETAP 1)');
}

// Poczekaj aż DOM się załaduje
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    observeUrlChanges();
    setTimeout(checkAndNotifyState, 500);
  });
} else {
  observeUrlChanges();
  setTimeout(checkAndNotifyState, 500);
}

// Sprawdzaj stan co 1 sekundę (backup dla edge cases)
backupIntervalId = setInterval(checkAndNotifyState, 1000);

