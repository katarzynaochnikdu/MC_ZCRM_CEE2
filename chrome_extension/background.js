// Background service worker - obsługa stanów Gmaila (ETAP 1 + ETAP 2)

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
  backgroundLogger.captureConsole(); // Przechwytuj wszystko z konsoli
  if (!self.loggers) self.loggers = [];
  self.loggers.push(backgroundLogger);
}

// ETAP 1: Przechowuje aktualny stan Gmaila
let currentState = null;

// ETAP 2: URL do GAS WebApp (używamy tego z logger.js, który jest już załadowany)
// Jeśli logger.js nie załadował się, użyj fallback URL
const GAS_WEB_APP_URL_FOR_FETCH = typeof GAS_WEB_APP_URL !== 'undefined' 
  ? GAS_WEB_APP_URL 
  : 'https://script.google.com/a/macros/med-space.pl/s/AKfycbwX0Oeur5Hx5k0-T8IbgyeK67vhHfepA5lRNypftgL4wDNFeK8-BkrXZTlKzuW39p8/exec';

// ETAP 2: Funkcja wywołująca GAS WebApp
async function callGAS(action, params) {
  try {
    const response = await fetch(GAS_WEB_APP_URL_FOR_FETCH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: action,
        ...params
      })
    });

    // Sprawdź Content-Type
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    
    // Jeśli odpowiedź to HTML (błąd lub strona logowania)
    if (contentType.includes('text/html') || text.trim().startsWith('<')) {
      console.error(`[Background] GAS zwrócił HTML zamiast JSON (${action}):`, text.substring(0, 200));
      return { 
        success: false, 
        error: 'GAS zwrócił HTML zamiast JSON. Sprawdź czy WebApp jest poprawnie wdrożony i czy URL jest prawidłowy.',
        htmlResponse: text.substring(0, 500)
      };
    }

    // Próbuj odczytać odpowiedź JSON
    const data = JSON.parse(text);
    
    console.log(`[Background] Odpowiedź z GAS (${action}):`, data);
    if (backgroundLogger) {
      backgroundLogger.info(`Odpowiedź z GAS (${action})`, data);
    }

    return data;
  } catch (error) {
    console.error(`[Background] Błąd wywołania GAS (${action}):`, error);
    if (backgroundLogger) {
      backgroundLogger.error(`Błąd wywołania GAS (${action})`, { error: error.toString() });
    }
    
    // Zwróć mock data jeśli GAS nie odpowiada
    return { success: false, error: error.toString() };
  }
}

// Nasłuchuj na wiadomości od content script i sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Background] Otrzymano wiadomość:', message.type, message);
  
  // ========== ETAP 1: System stanów ==========
  if (message.type === 'gmail-state-changed') {
    console.log('[Background] Otrzymano zmianę stanu:', message.data);
    if (backgroundLogger) {
      backgroundLogger.info('Zmiana stanu Gmaila', message.data);
    }
    
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
    
    // ETAP 2: AUTO-FETCH gdy mail_opened
    if (message.data.stan === 'mail_opened' && message.data.messageId) {
      console.log('[Background] Auto-fetch dla mail_opened:', message.data.messageId);
      
      // Wywołaj GAS (async)
      callGAS('fetch-message-simple', {
        messageId: message.data.messageId,
        threadId: message.data.threadId
      }).then(result => {
        // Wyślij prawdziwe dane z GAS do sidepanel
        if (result.success) {
          chrome.runtime.sendMessage({
            type: 'auto-mail-data',
            data: result
          }).catch(() => {});
        } else {
          console.error('[Background] Auto-fetch failed:', result.error);
        }
      });
    }
    
    sendResponse({ success: true });
  }
  
  // Endpoint dla sidepanel do pobrania aktualnego stanu
  if (message.type === 'get-current-state') {
    console.log('[Background] Sidepanel pyta o aktualny stan');
    sendResponse(currentState);
  }
  
  // ========== ETAP 2: Manual fetch - pełna wiadomość ==========
  if (message.type === 'manual-fetch-message') {
    console.log('[Background] Manual-fetch-message:', message.messageId);
    
    callGAS('fetch-message-full', {
      messageId: message.messageId,
      threadId: message.threadId
    }).then(result => {
      // Wyślij prawdziwe dane z GAS do sidepanel
      if (result.success) {
        chrome.runtime.sendMessage({
          type: 'full-message-ready',
          data: result
        }).catch(() => {});
      } else {
        console.error('[Background] Manual-fetch-message failed:', result.error);
      }
    });
    
    sendResponse({ success: true });
  }
  
  // ========== ETAP 2: Manual fetch - pełny wątek ==========
  if (message.type === 'manual-fetch-thread') {
    console.log('[Background] ⭐ Manual-fetch-thread otrzymane:', message.threadId, 'messageId:', message.messageId);
    
    callGAS('fetch-thread-full', {
      threadId: message.threadId,
      messageId: message.messageId || currentState?.messageId
    }).then(result => {
      console.log('[Background] ⭐ Odpowiedź z GAS (fetch-thread-full):', result);
      
      // Wyślij prawdziwe dane z GAS do sidepanel
      if (result.success) {
        console.log('[Background] ⭐ Wysyłam full-thread-ready do sidepanel');
        chrome.runtime.sendMessage({
          type: 'full-thread-ready',
          data: result
        }).catch((err) => {
          console.error('[Background] Błąd wysyłania full-thread-ready:', err);
        });
      } else {
        console.error('[Background] Manual-fetch-thread failed:', result.error);
      }
    });
    
    sendResponse({ success: true });
  }
  
  return true; // Asynchroniczna odpowiedź
});

// Ustaw zachowanie panelu - otwieranie po kliknięciu w ikonę (toggle obsługuje Chrome)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[Background] Błąd ustawiania panelu:', error));

// Usuwamy onClicked listener, bo Chrome sam obsłuży toggle
// chrome.action.onClicked.addListener(...) <- TO BYŁO ZŁE


console.log('[Background] Service worker uruchomiony (ETAP 1 + ETAP 2)');
if (backgroundLogger) {
  backgroundLogger.info('Service worker uruchomiony (ETAP 1 + ETAP 2)');
}
