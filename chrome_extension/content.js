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
  const hash = window.location.hash || '';
  // Gmail używa formatu: #inbox/FMfcgzQcqbVqhJGvhPTCqTmcZpGmwNfm
  const match = hash.match(/\/([a-zA-Z0-9_-]{10,})$/);
  return match ? match[1] : null;
}

// Funkcja pobierająca messageId z DOM
function getMessageIdFromDom() {
  const candidates = [
    'div[role="main"] div[data-legacy-message-id][tabindex="-1"]',
    'div[role="main"] div[data-message-id][tabindex="-1"]',
    'div[role="main"] div[data-legacy-message-id]',
    'div[role="main"] div[data-message-id]'
  ];

  for (const selector of candidates) {
    const nodes = document.querySelectorAll(selector);
    if (nodes.length > 0) {
      const node = nodes[nodes.length - 1];
      return node.getAttribute('data-legacy-message-id') || node.getAttribute('data-message-id');
    }
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

  // STAN 1: Ładowanie
  if (isGmailLoading()) {
    return {
      stan: STAN_LOADING,
      timestamp: Date.now()
    };
  }

  const threadId = getThreadIdFromHash();
  const messageId = getMessageIdFromDom();

  // STAN 2: Lista inbox (brak otwartego maila)
  if (!threadId || !messageId) {
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
  
  chrome.runtime.sendMessage({
    type: 'gmail-state-changed',
    data: state
  }).catch(err => {
    console.error('[Content Script] Błąd wysyłania stanu:', err);
  });
  
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
  const observer = new MutationObserver(() => {
    if (currentUrl !== window.location.href) {
      currentUrl = window.location.href;
      setTimeout(checkAndNotifyState, 100);
    } else {
      // Sprawdź też zmiany w DOM (może się zmienić messageId bez zmiany URL)
      checkAndNotifyState();
    }
  });

  observer.observe(document.body, {
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
setInterval(checkAndNotifyState, 1000);

