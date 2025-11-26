// Sidepanel - wyświetlanie stanów Gmaila (ETAP 1)

// Import loggera
const sidepanelLogger = new Logger('Sidepanel');
sidepanelLogger.captureConsole(); // Przechwytuj wszystko z konsoli
if (!window.loggers) window.loggers = [];
window.loggers.push(sidepanelLogger);

const messageIdElement = document.getElementById('messageId');
const threadIdElement = document.getElementById('threadId');
const statusElement = document.getElementById('status');

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

// Funkcja aktualizująca UI na podstawie stanu
function updateUI(state) {
  if (!state) {
    // Brak stanu - nie jesteśmy w Gmail lub jeszcze nie wykryto
    statusElement.textContent = '⏸️ Oczekiwanie...';
    statusElement.className = 'status inactive';
    messageIdElement.innerHTML = '<span class="no-data">Nie wykryto stanu Gmaila</span>';
    threadIdElement.innerHTML = '<span class="no-data">-</span>';
    return;
  }

  // Aktualizuj status
  statusElement.textContent = STAN_NAMES[state.stan] || '❓ Nieznany stan';
  statusElement.className = STAN_COLORS[state.stan] || 'status inactive';

  // Aktualizuj messageId
  if (state.messageId) {
    messageIdElement.innerHTML = `<strong>${state.messageId}</strong>`;
  } else {
    messageIdElement.innerHTML = '<span class="no-data">Brak</span>';
  }

  // Aktualizuj threadId
  if (state.threadId) {
    threadIdElement.innerHTML = state.threadId;
  } else {
    threadIdElement.innerHTML = '<span class="no-data">-</span>';
  }

  console.log('[Sidepanel] Zaktualizowano UI stanem:', state);
}

// Nasłuchuj na wiadomości od background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'state-update') {
    console.log('[Sidepanel] Otrzymano update stanu:', message.data);
    updateUI(message.data);
  }
});

// Przy uruchomieniu sidepanel, zapytaj background.js o aktualny stan
chrome.runtime.sendMessage({
  type: 'get-current-state'
}, (response) => {
  console.log('[Sidepanel] Pobrano aktualny stan:', response);
  updateUI(response);
});

console.log('[Sidepanel] Zainicjalizowano (ETAP 1 - System stanów)');
sidepanelLogger.info('Sidepanel zainicjalizowano (ETAP 1 - System stanów)');
