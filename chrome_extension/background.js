// Background service worker - obsługa stanów Gmaila (ETAP 1)

// Import loggera dla service worker
try {
  importScripts('logger.js');
} catch (e) {
  console.warn('[Background] Nie można załadować logger.js:', e);
}

// Inicjalizacja loggera
let backgroundLogger = null;
if (typeof Logger !== 'undefined') {
  backgroundLogger = new Logger('Background');
  if (!self.loggers) self.loggers = [];
  self.loggers.push(backgroundLogger);
}

// Przechowuje aktualny stan Gmaila
let currentState = null;

// Nasłuchuj na zmiany stanu od content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'gmail-state-changed') {
    console.log('[Background] Otrzymano zmianę stanu:', message.data);
    backgroundLogger.info('Zmiana stanu Gmaila', message.data);
    
    // Zapisz aktualny stan
    currentState = message.data;
    
    // Wyślij stan do sidepanel
    chrome.runtime.sendMessage({
      type: 'state-update',
      data: currentState
    }).catch(() => {
      // Sidepanel może być niezaładowany - to normalne
      console.log('[Background] Sidepanel nie jest otwarty');
    });
    
    sendResponse({ success: true });
  }
  
  // Endpoint dla sidepanel do pobrania aktualnego stanu
  if (message.type === 'get-current-state') {
    console.log('[Background] Sidepanel pyta o aktualny stan');
    sendResponse(currentState);
  }
  
  return true; // Asynchroniczna odpowiedź
});

// Obsługa kliknięcia w ikonę rozszerzenia - otwórz sidepanel
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
  console.log('[Background] Otwieram sidepanel');
});

console.log('[Background] Service worker uruchomiony (ETAP 1 - System stanów)');
backgroundLogger.info('Service worker uruchomiony (ETAP 1 - System stanów)');
