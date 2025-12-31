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
  : 'https://script.google.com/a/macros/med-space.pl/s/AKfycbz_Z30Ioqs5fCziztl1kYL3cgOTV6BPKpdhqWDNYTl_kULklcE42wxMniQR3IO58oA/exec';

// ETAP 2*: Konfiguracja auto-fetch (true = włączony, false = wyłączony)
const AUTO_FETCH_ENABLED = true;

// ETAP 2*: Dwuwarstwowy cache (pamięć + chrome.storage.local)
let threadCache = {};   // { threadId: { messageIds: [], lastSyncedAt: timestamp } }
let messageCache = {};  // { messageId: { threadId, processed, hasAnalysis, lastFetchedAt } }

// ETAP 2*: Funkcje zarządzania cache
async function loadCacheFromStorage() {
  try {
    // Bezpieczne sprawdzenie dostępności API storage (np. po invalidacji kontekstu extension)
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      console.warn('[Background] chrome.storage.local niedostępne - pomijam ładowanie cache');
      return;
    }
    const result = await chrome.storage.local.get(['threadCache', 'messageCache']);
    threadCache = result.threadCache || {};
    messageCache = result.messageCache || {};
    console.log('[Background] 💾 Cache załadowany z storage:', {
      threads: Object.keys(threadCache).length,
      messages: Object.keys(messageCache).length
    });
    if (backgroundLogger) {
      backgroundLogger.info('Cache załadowany', {
        threadCount: Object.keys(threadCache).length,
        messageCount: Object.keys(messageCache).length
      });
    }
  } catch (error) {
    console.error('[Background] Błąd ładowania cache:', error);
  }
}

async function saveCacheToStorage() {
  try {
    if (!chrome || !chrome.storage || !chrome.storage.local) {
      console.warn('[Background] chrome.storage.local niedostępne - pomijam zapisywanie cache');
      return;
    }
    await chrome.storage.local.set({
      threadCache: threadCache,
      messageCache: messageCache
    });
    const stats = {
      threads: Object.keys(threadCache).length,
      messages: Object.keys(messageCache).length,
      processed: Object.values(messageCache).filter(m => m.processed).length
    };
    console.log('[Background] 💾 Cache zapisany do storage:', stats);
    if (backgroundLogger) {
      backgroundLogger.info('💾 Cache zapisany', stats);
    }
  } catch (error) {
    console.error('[Background] Błąd zapisywania cache:', error);
  }
}

function updateMessageCache(messageId, threadId, processed = true) {
  const existing = messageCache[messageId] || {};
  messageCache[messageId] = {
    threadId: threadId,
    processed: processed,
    hasAnalysis: existing.hasAnalysis || false,
    lastFetchedAt: Date.now(),
    // ETAP 4: Analiza LLM
    analysisData: existing.analysisData || null,
    analyzedAt: existing.analyzedAt || null
  };
}

function updateThreadCache(threadId, messageIds, hasFullThreadFetched = false) {
  const existing = threadCache[threadId] || {};
  threadCache[threadId] = {
    messageIds: messageIds,
    lastSyncedAt: Date.now(),
    // Jeśli wcześniej mieliśmy info że pełny wątek był pobrany, zachowaj je
    hasFullThreadFetched: existing.hasFullThreadFetched || hasFullThreadFetched
  };
}

// ETAP 2: Funkcja wywołująca GAS WebApp
async function callGAS(action, params) {
  const startTime = performance.now();
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
    const fetchTime = performance.now() - startTime;
    
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
    const dataSize = new Blob([text]).size;
    
    // Nie loguj całej odpowiedzi (potrafi zawierać pełne treści maili / duże obiekty)
    console.log(`[Background] Odpowiedź z GAS (${action}): ${fetchTime.toFixed(0)}ms, ${dataSize} bytes`, {
      success: Boolean(data?.success),
      messageId: params?.messageId || data?.messageId || '-',
      threadId: params?.threadId || data?.threadId || '-',
    });
    if (backgroundLogger) {
      backgroundLogger.info(`📊 Performance GAS (${action})`, {
        fetchTime: `${fetchTime.toFixed(0)}ms`,
        dataSize: `${dataSize} bytes`,
        messageId: params.messageId || '-',
        threadId: params.threadId || '-'
      });
    }

    return data;
  } catch (error) {
    const fetchTime = performance.now() - startTime;
    console.error(`[Background] Błąd wywołania GAS (${action}) po ${fetchTime.toFixed(0)}ms:`, error);
    if (backgroundLogger) {
      backgroundLogger.error(`Błąd wywołania GAS (${action})`, { 
        error: error.toString(),
        fetchTime: `${fetchTime.toFixed(0)}ms`
      });
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
    
    // ETAP 2*: AUTO-FETCH gdy mail_opened (z cache)
    if (AUTO_FETCH_ENABLED && message.data.stan === 'mail_opened' && message.data.messageId) {
      const autoFetchStart = performance.now();
      const msgId = message.data.messageId;
      const tId = message.data.threadId;
      
      console.log('[Background] 🚀 AUTO-FETCH-FULL START:', msgId);
      
      // KROK 1: Sprawdź messageCache
      const cached = messageCache[msgId];
      const shouldFetch = !cached || !cached.processed;
      
      if (cached && cached.processed) {
        console.log('[Background] 💾 Wiadomość już pobrana (cache), skip fetch:', msgId);
        if (backgroundLogger) {
          backgroundLogger.info('💾 Message w cache - skip fetch', {
            messageId: msgId,
            lastFetchedAt: new Date(cached.lastFetchedAt).toISOString()
          });
        }
      }
      
      // KROK 1A: Pobierz pełną wiadomość (jeśli nie w cache)
      const fetchPromise = shouldFetch 
        ? callGAS('fetch-message-full', { messageId: msgId, threadId: tId })
        : Promise.resolve(null);
      
      fetchPromise.then(result => {
        const totalTime = performance.now() - autoFetchStart;
        
        if (result && result.success) {
          console.log(`[Background] ✅ AUTO-FETCH-FULL COMPLETE: ${totalTime.toFixed(0)}ms, ${result.plainBody?.length || 0} chars`);
          if (backgroundLogger) {
            backgroundLogger.info('📊 AUTO-FETCH-FULL Total Time', {
              totalTime: `${totalTime.toFixed(0)}ms`,
              messageId: msgId,
              bodyLength: result.plainBody?.length || 0,
              attachments: result.attachments?.length || 0
            });
          }
          
          // Aktualizuj messageCache
          updateMessageCache(msgId, tId, true);
          saveCacheToStorage();
          
          // Wyślij dane wiadomości do sidepanel
          chrome.runtime.sendMessage({
            type: 'auto-mail-data',
            data: result
          }).catch(() => {});
        }
        
        // KROK 2: Thread Intelligence - pobierz listę messageIds w wątku
        const metadataStart = performance.now();
        console.log('[Background] 🧠 Thread Intelligence: pobieram listę messageIds...');
        
        callGAS('get-thread-metadata', {
          messageId: msgId
        }).then(metadata => {
          const metadataTime = performance.now() - metadataStart;
          if (metadata.success) {
            console.log(`[Background] 📊 Thread metadata: ${metadataTime.toFixed(0)}ms, messageCount=${metadata.messageCount}`);
            if (backgroundLogger) {
              backgroundLogger.info('📊 Thread Metadata Check', {
                fetchTime: `${metadataTime.toFixed(0)}ms`,
                messageCount: metadata.messageCount,
                hasMultipleMessages: metadata.hasMultipleMessages
              });
            }
            
            // KROK 3: Aktualizuj threadCache (jeśli zwraca messageIds)
            if (metadata.messageIds && Array.isArray(metadata.messageIds)) {
              const oldIds = threadCache[tId]?.messageIds || [];
              const newIds = metadata.messageIds;
              
              // Dodaj nowe messageIds do messageCache
              newIds.forEach(id => {
                if (!messageCache[id]) {
                  messageCache[id] = {
                    threadId: tId,
                    processed: false,
                    hasAnalysis: false,
                    lastFetchedAt: null
                  };
                }
              });
              
              // Aktualizuj threadCache (bez oznaczania pełnego pobrania wątku)
              updateThreadCache(tId, newIds, false);
              
              console.log(`[Background] 📝 Thread cache zaktualizowany: ${oldIds.length} → ${newIds.length} messages`);
            } else {
              // Fallback - jeśli GAS nie zwraca messageIds, zapisz tylko metadata
              if (!threadCache[tId]) {
                updateThreadCache(tId, [msgId]);
              }
            }
            
            saveCacheToStorage();
            
            // Dodaj informację czy wątek był kiedyś pobrany jako pełny
            const threadEntry = threadCache[tId];
            metadata.uiThreadId = tId;
            metadata.wasFullThreadFetched = !!(threadEntry && threadEntry.hasFullThreadFetched);
            
            // Wyślij metadata do sidepanel
            chrome.runtime.sendMessage({
              type: 'thread-metadata',
              data: metadata
            }).catch(() => {});
          }
        });
      });
    } else if (!AUTO_FETCH_ENABLED && message.data.stan === 'mail_opened') {
      console.log('[Background] ⏸️ AUTO-FETCH wyłączony (ustaw AUTO_FETCH_ENABLED = true aby włączyć)');
    }
    
    sendResponse({ success: true });
  }
  
  // Endpoint dla sidepanel do pobrania aktualnego stanu
  if (message.type === 'get-current-state') {
    console.log('[Background] Sidepanel pyta o aktualny stan');
    sendResponse(currentState);
  }
  
  // ========== ETAP 2*: Manual-fetch-message USUNIĘTE ==========
  // AUTO-FETCH teraz pobiera pełną wiadomość, więc manual-message nie jest potrzebny
  if (message.type === 'manual-fetch-message') {
    console.log('[Background] ⚠️ manual-fetch-message NIE UŻYWANE (auto-fetch pobiera pełną wiadomość)');
    sendResponse({ success: false, info: 'Użyj auto-fetch lub manual-fetch-thread' });
  }
  
  // ========== ETAP 2*: Manual fetch - pełny wątek (z cache) ==========
  if (message.type === 'manual-fetch-thread') {
    const manualThreadStart = performance.now();
    const tId = message.threadId;
    const msgId = message.messageId || currentState?.messageId;
    
    console.log('[Background] 🧵 MANUAL-THREAD-FETCH START:', tId, 'messageId:', msgId);
    
    callGAS('fetch-thread-full', {
      threadId: tId,
      messageId: msgId
    }).then(result => {
      const totalTime = performance.now() - manualThreadStart;
      // Nie loguj pełnej odpowiedzi (wątek może być duży) – tylko podsumowanie
      console.log('[Background] ⭐ Odpowiedź z GAS (fetch-thread-full):', {
        success: Boolean(result?.success),
        threadId: result?.threadId || '-',
        apiThreadId: result?.apiThreadId || '-',
        messageCount: result?.messageCount || 0
      });
      
      if (result.success) {
        console.log(`[Background] ✅ MANUAL-THREAD-FETCH COMPLETE: ${totalTime.toFixed(0)}ms, ${result.messageCount || 0} messages`);
        if (backgroundLogger) {
          backgroundLogger.info('📊 MANUAL-THREAD-FETCH Total Time', {
            totalTime: `${totalTime.toFixed(0)}ms`,
            messageCount: result.messageCount || 0,
            threadId: tId
          });
        }
        
        // KROK 1: Zbuduj listę messageIds z result.messages[]
        const messageIds = result.messages ? result.messages.map(msg => msg.messageId) : [msgId];
        // Oznacz, że pełny wątek został pobrany (hasFullThreadFetched = true)
        updateThreadCache(tId, messageIds, true);
        
        console.log(`[Background] 📝 Thread cache zaktualizowany: ${messageIds.length} messages dla ${tId}`);
        
        // KROK 2: Dla każdej wiadomości zaktualizuj messageCache
        if (result.messages && Array.isArray(result.messages)) {
          result.messages.forEach(msg => {
            if (msg.messageId) {
              updateMessageCache(msg.messageId, tId, true);
            }
          });
          console.log(`[Background] 📝 Message cache zaktualizowany: ${result.messages.length} wiadomości`);
        }
        
        // Zapisz cache
        saveCacheToStorage();
        
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

  // ETAP 4: Analyze-message (LLM)
  if (message.type === 'analyze-message') {
    const msgId = message.messageId;
    const tId = message.threadId;
    
    console.log('[Background] 🤖 Analyze-message START:', msgId);
    
    // ✅ POPRAWKA: Sprawdź najpierw czy mamy wynik w cache
    const cachedEntry = messageCache[msgId];
    if (cachedEntry && cachedEntry.hasAnalysis && cachedEntry.analysisData) {
      console.log('[Background] 💾 Analyze-message: zwracam z cache (messageCache)');
      
      // Wyślij z cache
      sendResponse({ 
        success: true, 
        fromCache: true,
        analysis: cachedEntry.analysisData 
      });
      
      // Wyślij też event do sidepanel
      chrome.runtime.sendMessage({
        type: 'analysis-ready',
        messageId: msgId,
        data: cachedEntry.analysisData,
        fromCache: true
      }).catch(() => {});
      
      return true;
    }
    
    const analyzeStart = performance.now();
    callGAS('analyze-message', {
      messageId: msgId,
      threadId: tId
    }).then(result => {
      const analyzeTime = performance.now() - analyzeStart;
      
      if (result.success) {
        const isCached = result.metadata?.cached || false;
        console.log(`[Background] ✅ Analyze-message OK: ${analyzeTime.toFixed(0)}ms` + 
                    (isCached ? ' (z Firestore cache)' : ' (nowa analiza)'));
        
        // Aktualizuj messageCache
        if (messageCache[msgId]) {
          messageCache[msgId].hasAnalysis = true;
          messageCache[msgId].analysisData = result.analysis || null;
          messageCache[msgId].analyzedAt = Date.now();
        } else {
          // Jeśli z jakiegoś powodu nie ma wpisu, utwórz
          messageCache[msgId] = {
            threadId: tId,
            processed: true,
            hasAnalysis: true,
            lastFetchedAt: null,
            analysisData: result.analysis || null,
            analyzedAt: Date.now()
          };
        }
        
        // Zapisz cache
        saveCacheToStorage();
        
        if (backgroundLogger) {
          backgroundLogger.info('🤖 LLM Analysis Complete', {
            analyzeTime: `${analyzeTime.toFixed(0)}ms`,
            messageId: msgId,
            threadId: tId,
            companiesCount: result.analysis?.companies?.length || 0,
            contactsCount: result.analysis?.contacts?.length || 0,
            fromFirestoreCache: isCached
          });
        }
        
        console.log('[Background] ⭐ Wysyłam analysis-ready do sidepanel');
        chrome.runtime.sendMessage({
          type: 'analysis-ready',
          messageId: msgId,
          data: result.analysis,
          metadata: result.metadata
        }).catch((err) => {
          console.error('[Background] Błąd wysyłania analysis-ready:', err);
        });
        
        // ✅ POPRAWKA: Wyślij odpowiedź przez sendResponse
        sendResponse({ 
          success: true, 
          analysis: result.analysis,
          metadata: result.metadata
        });
      } else {
        console.error('[Background] Analyze-message failed:', result.error);
        chrome.runtime.sendMessage({
          type: 'analysis-error',
          messageId: msgId,
          error: result.error
        }).catch(() => {});
        
        // ✅ POPRAWKA: Wyślij błąd przez sendResponse
        sendResponse({ 
          success: false, 
          error: result.error 
        });
      }
    }).catch(error => {
      console.error('[Background] Analyze-message ERROR:', error);
      sendResponse({ 
        success: false, 
        error: error.toString() 
      });
    });
    
    // ✅ WAŻNE: Zwracamy true żeby Chrome wiedział że sendResponse będzie wywołane asynchronicznie
    return true;
  }

  // ETAP 4: Pobierz cache dla konkretnej wiadomości (do sprawdzenia hasAnalysis)
  if (message.type === 'get-message-cache') {
    const msgId = message.messageId;
    const cache = messageCache[msgId] || null;
    sendResponse({ success: true, cache: cache });
  }
  
  return true; // Asynchroniczna odpowiedź
});

// Ustaw zachowanie panelu - otwieranie po kliknięciu w ikonę (toggle obsługuje Chrome)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[Background] Błąd ustawiania panelu:', error));

// Usuwamy onClicked listener, bo Chrome sam obsłuży toggle
// chrome.action.onClicked.addListener(...) <- TO BYŁO ZŁE


console.log('[Background] Service worker uruchomiony (ETAP 2*: Auto-Full + Manual-Thread)');
if (backgroundLogger) {
  backgroundLogger.info('Service worker uruchomiony (ETAP 2*: Auto-Full + Manual-Thread)');
}

// ETAP 2*: Załaduj cache z storage przy starcie
loadCacheFromStorage();
