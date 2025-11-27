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

// ETAP 2: Przechowuje aktualny stan (aby ignorować nieaktualne dane)
let currentState = null;

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

// Mapowanie stanów na czytelne nazwy
const STAN_NAMES = {
  'loading': '⏳ Ładowanie Gmaila...',
  'inbox_list': '📋 Lista maili',
  'mail_opened': '📧 Mail otwarty',
  'mail_changed': '🔄 Zmiana maila',
  'thread_view': '🧵 Widok wątku'
};

// Mapowanie stanów na kolory statusu
const STAN_COLORS = {
  'loading': 'status loading',
  'inbox_list': 'status inactive',
  'mail_opened': 'status active',
  'mail_changed': 'status active',
  'thread_view': 'status active'
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
  }

  if (!state) {
    // Brak stanu - nie jesteśmy w Gmail lub jeszcze nie wykryto
    statusElement.textContent = '⏸️ Oczekiwanie...';
    statusElement.className = 'status inactive';
    messageIdElement.textContent = 'Nie wykryto stanu Gmaila';
    messageIdElement.style.fontWeight = 'normal';
    threadIdElement.textContent = '-';
    return;
  }

  // Aktualizuj status
  statusElement.textContent = STAN_NAMES[state.stan] || '❓ Nieznany stan';
  statusElement.className = STAN_COLORS[state.stan] || 'status inactive';

  // Aktualizuj messageId (używamy textContent żeby nie usuwać click listener)
  if (state.messageId) {
    messageIdElement.textContent = state.messageId;
    messageIdElement.style.fontWeight = 'bold';
  } else {
    messageIdElement.textContent = 'Brak';
    messageIdElement.style.fontWeight = 'normal';
  }

  // Aktualizuj threadId (używamy textContent żeby nie usuwać click listener)
  if (state.threadId) {
    threadIdElement.textContent = state.threadId;
  } else {
    threadIdElement.textContent = '-';
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

// ETAP 2: Obsługa kliknięcia w Message ID
messageIdElement.addEventListener('click', () => {
  if (!currentState || !currentState.messageId) {
    console.log('[Sidepanel] Brak messageId do pobrania');
    return;
  }

  console.log('[Sidepanel] Kliknięto Message ID - żądanie pełnej wiadomości:', currentState.messageId);
  chrome.runtime.sendMessage({
    type: 'manual-fetch-message',
    messageId: currentState.messageId,
    threadId: currentState.threadId
  }).catch(err => {
    console.log('[Sidepanel] Błąd wysyłania manual-fetch-message:', err.message);
  });

  // Wizualna informacja
  fetchedData.textContent = '⏳ Pobieranie pełnej wiadomości...';
  fetchedDataSection.style.display = 'block';
});

// ETAP 2: Obsługa kliknięcia w Thread ID
if (threadIdElement) {
  threadIdElement.addEventListener('click', () => {
    console.log('[Sidepanel] CLICK na Thread ID - currentState:', currentState);
    
    if (!currentState || !currentState.threadId) {
      console.log('[Sidepanel] Brak threadId do pobrania');
      return;
    }

    console.log('[Sidepanel] Kliknięto Thread ID - żądanie pełnego wątku:', currentState.threadId, 'messageId:', currentState.messageId);
    
    chrome.runtime.sendMessage({
      type: 'manual-fetch-thread',
      threadId: currentState.threadId,
      messageId: currentState.messageId
    }).then(response => {
      console.log('[Sidepanel] Odpowiedź z background (manual-fetch-thread):', response);
    }).catch(err => {
      console.log('[Sidepanel] Błąd wysyłania manual-fetch-thread:', err.message);
    });

    // Wizualna informacja
    if (fetchedData) {
      fetchedData.textContent = '⏳ Pobieranie pełnego wątku...';
    }
    if (fetchedDataSection) {
      fetchedDataSection.style.display = 'block';
    }
  });
  console.log('[Sidepanel] Click listener dodany do Thread ID');
} else {
  console.error('[Sidepanel] threadIdElement nie znaleziony!');
}

// Nasłuchuj na wiadomości od background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ETAP 1: Update stanu Gmaila
  if (message.type === 'state-update') {
    console.log('[Sidepanel] Otrzymano update stanu:', message.data);
    updateUI(message.data);
  }

  // ETAP 2: Auto-fetch (szybki podgląd)
  if (message.type === 'auto-mail-data') {
    console.log('[Sidepanel] Otrzymano auto-fetch data:', message.data);
    displayFetchedData(message.data, 'message');
  }

  // ETAP 2: Manual message fetch (pełne dane)
  if (message.type === 'full-message-ready') {
    console.log('[Sidepanel] Otrzymano full-message-ready:', message.data);
    displayFetchedData(message.data, 'message');
  }

  // ETAP 2: Manual thread fetch (pełny wątek)
  if (message.type === 'full-thread-ready') {
    console.log('[Sidepanel] Otrzymano full-thread-ready:', message.data);
    displayFetchedData(message.data, 'thread');
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

console.log('[Sidepanel] Zainicjalizowano (ETAP 1 + ETAP 2)');
sidepanelLogger.info('Sidepanel zainicjalizowano (ETAP 1 + ETAP 2)');
