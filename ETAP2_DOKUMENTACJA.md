# ETAP 2 – Auto + Manual Fetch (Dokumentacja)

## Przegląd

ETAP 2 dodaje do rozszerzenia możliwość pobierania treści maili z Gmail API poprzez Google Apps Script WebApp.

**Dwa tryby:**
1. **AUTO-FETCH** – automatyczne pobieranie minimalnych danych przy otwarciu maila (`mail_opened`)
2. **MANUAL-FETCH** – pobieranie pełnych danych po kliknięciu w Message ID lub Thread ID

## Architektura

```
Content Script (ETAP 1) → Background → GAS WebApp → Gmail API
                             ↓
                          Sidepanel (wyświetla dane)
```

**Ważne zasady:**
- ✅ Content script **NIE ZMIENIA SIĘ** (ETAP 1 pozostaje nietknięty)
- ✅ Sidepanel **zawsze pokazuje aktualny stan Gmaila**
- ✅ Dane są ignorowane jeśli `messageId` lub `threadId` się nie zgadzają
- ✅ Nic nie blokuje UI
- ✅ GAS jest jedynym punktem dostępu do Gmail API

---

## 1. Sidepanel (ETAP 2)

### Zmiany w `sidepanel.html`

**Dodano:**
- Klasy CSS `.clickable` dla Message ID i Thread ID
- Sekcję `#fetchedDataSection` do wyświetlania pobranych danych
- Efekty hover/active dla klikalnych elementów

**Kod:**

```html
<div class="info-row">
  <div class="label">Message ID:</div>
  <div class="value clickable" id="messageId" title="Kliknij aby pobrać pełną wiadomość">
    <span class="no-data">Nie wykryto</span>
  </div>
</div>

<div class="info-row">
  <div class="label">Thread ID:</div>
  <div class="value clickable" id="threadId" title="Kliknij aby pobrać pełny wątek">
    <span class="no-data">-</span>
  </div>
</div>

<!-- Sekcja pobranych danych -->
<div id="fetchedDataSection" style="display: none;">
  <hr style="margin: 20px 0;">
  <h2>📩 Pobrane dane:</h2>
  <div id="fetchedData"></div>
</div>
```

### Zmiany w `sidepanel.js`

**Plik:** `chrome_extension/sidepanel.js`

**Dodano:**

1. **Zmienna `currentState`** – przechowuje aktualny stan Gmaila do weryfikacji

```javascript
let currentState = null;
```

2. **Funkcja `displayFetchedData()`** – wyświetla dane z weryfikacją aktualności

```70:95:chrome_extension/sidepanel.js
function displayFetchedData(data, type) {
  // Weryfikacja aktualności danych
  if (type === 'message' && data.messageId !== currentState?.messageId) {
    console.log('[Sidepanel] Ignoruję nieaktualne dane message (messageId się nie zgadza)');
    return;
  }
  
  if (type === 'thread' && data.threadId !== currentState?.threadId) {
    console.log('[Sidepanel] Ignoruję nieaktualne dane thread (threadId się nie zgadza)');
    return;
  }

  // OK - dane aktualne, wyświetl
  if (fetchedDataSection) {
    fetchedDataSection.style.display = 'block';
  }

  // Wyświetl dane w formacie JSON
  fetchedData.textContent = JSON.stringify(data, null, 2);

  console.log('[Sidepanel] Wyświetlono pobrane dane:', type, data);
}
```

3. **Click listener dla Message ID**

```97:114:chrome_extension/sidepanel.js
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
  });

  // Wizualna informacja
  fetchedData.textContent = '⏳ Pobieranie pełnej wiadomości...';
  fetchedDataSection.style.display = 'block';
});
```

4. **Click listener dla Thread ID**

```116:147:chrome_extension/sidepanel.js
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
    }, (response) => {
      console.log('[Sidepanel] Odpowiedź z background (manual-fetch-thread):', response);
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
```

5. **3 nowe message listeners w `chrome.runtime.onMessage.addListener`**

```157:173:chrome_extension/sidepanel.js
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
```

---

## 2. Background (ETAP 2)

### Plik: `chrome_extension/background.js`

### Dodano:

1. **`GAS_WEB_APP_URL`** – URL do GAS WebApp

```javascript
const GAS_WEB_APP_URL = 'https://script.google.com/a/macros/med-space.pl/s/AKfycbx3O1NZWZZtRMVGXsMf-gi25GHbH-KnsLe9rPj-8HWr682Drs_Mk0z-cJjO0r5Q-AM/exec';
```

2. **Funkcja `callGAS(action, params)`** – komunikacja z GAS

```25:72:chrome_extension/background.js
async function callGAS(action, params) {
  try {
    const response = await fetch(GAS_WEB_APP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const text = await response.text();
    
    // Jeśli odpowiedź jest pusta lub nie-JSON, zwróć błąd
    if (!text || text.trim() === '') {
      return {
        success: false,
        error: 'Pusta odpowiedź z GAS'
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
```

3. **Auto-fetch w `gmail-state-changed` listener**

```97:116:chrome_extension/background.js
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
```

4. **Manual-fetch-message listener**

```127:147:chrome_extension/background.js
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
```

5. **Manual-fetch-thread listener**

```149:174:chrome_extension/background.js
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
```

---

## 3. GAS WebApp (ETAP 2)

### Plik: `G_APP_backend/Kod.js`

### Dodano 3 funkcje Gmail API:

#### 1. `fetchMessageSimple(messageId, threadId)`

**Cel:** Szybki auto-fetch (minimalne dane przy `mail_opened`)

**Używa:** `GmailApp.getMessageById()` (wbudowana usługa Gmail)

**Zwraca:**
```javascript
{
  success: true,
  messageId,
  threadId,
  subject,
  from,
  date,
  snippet: plainBody.substring(0, 200)
}
```

**Kod:**
```69:98:G_APP_backend/Kod.js
function fetchMessageSimple(messageId, threadId) {
  try {
    const message = GmailApp.getMessageById(messageId);
    
    if (!message) {
      return {
        success: false,
        error: 'Wiadomość nie znaleziona'
      };
    }
    
    return {
      success: true,
      messageId: messageId,
      threadId: threadId,
      subject: message.getSubject(),
      from: message.getFrom(),
      date: message.getDate().toISOString(),
      snippet: message.getPlainBody().substring(0, 200)
    };
    
  } catch (error) {
    Logger.log('Błąd fetchMessageSimple: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}
```

#### 2. `fetchMessageFull(messageId, threadId)`

**Cel:** Pełne dane wiadomości (manual-fetch po kliknięciu Message ID)

**Używa:** `GmailApp.getMessageById()` (wbudowana usługa Gmail)

**Zwraca:**
```javascript
{
  success: true,
  messageId,
  threadId,
  subject,
  from,
  to,
  cc,
  bcc,
  date,
  plainBody,
  htmlBody,
  attachments: [{name, size, type}],
  headers: {Message-ID, Reply-To}
}
```

**Kod:**
```100:142:G_APP_backend/Kod.js
function fetchMessageFull(messageId, threadId) {
  try {
    const message = GmailApp.getMessageById(messageId);
    
    if (!message) {
      return {
        success: false,
        error: 'Wiadomość nie znaleziona'
      };
    }
    
    return {
      success: true,
      messageId: messageId,
      threadId: threadId,
      subject: message.getSubject(),
      from: message.getFrom(),
      to: message.getTo(),
      cc: message.getCc(),
      bcc: message.getBcc(),
      date: message.getDate().toISOString(),
      plainBody: message.getPlainBody(),
      htmlBody: message.getBody(),
      attachments: message.getAttachments().map(att => ({
        name: att.getName(),
        size: att.getSize(),
        type: att.getContentType()
      })),
      headers: {
        'Message-ID': message.getId(),
        'Reply-To': message.getReplyTo()
      }
    };
    
  } catch (error) {
    Logger.log('Błąd fetchMessageFull: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}
```

#### 3. `fetchThreadFull(threadId, messageId)`

**Cel:** Pełny wątek (manual-fetch po kliknięciu Thread ID)

**UWAGA:** `threadId` z URL Gmaila (hash) **NIE DZIAŁA** w Gmail API. Dlatego funkcja:
1. Pobiera wiadomość przez `messageId` (hex ID z DOM działa w Gmail API)
2. Z wiadomości wyciąga `apiThreadId` (prawdziwy thread ID z API)
3. Pobiera cały wątek używając `apiThreadId`

**Używa:** `Gmail.Users.Messages.get()` i `Gmail.Users.Threads.get()` (Gmail Advanced Service)

**Zwraca:**
```javascript
{
  success: true,
  threadId: threadId || apiThreadId,  // UI threadId dla spójności
  apiThreadId: apiThreadId,            // Prawdziwy thread ID z API
  messageCount: messages.length,
  messages: [
    {
      messageId,
      threadId,
      subject,
      from,
      to,
      date,
      snippet,
      plainBody  // PEŁNA treść każdej wiadomości
    }
  ]
}
```

**Kod:**
```144:263:G_APP_backend/Kod.js
function fetchThreadFull(threadId, messageId) {
  try {
    Logger.log('DEBUG fetchThreadFull typeof Gmail = ' + (typeof Gmail));

    // Walidacja: wymagamy messageId, threadId jest tylko informacyjne (z UI)
    if (!messageId || messageId.trim() === '') {
      Logger.log('fetchThreadFull: messageId jest pusty. threadId z UI: ' + (threadId || 'brak'));
      return {
        success: false,
        error: 'messageId jest pusty – nie można pobrać wątku.'
      };
    }

    Logger.log('fetchThreadFull: Próba pobrania wątku po messageId: ' + messageId +
               ', threadId z UI: ' + (threadId || 'brak'));

    try {
      Logger.log('fetchThreadFull: Gmail.Users.Messages.get dla messageId: ' + messageId);

      // 1) Pobierz wiadomość przez Gmail API (akceptuje hex ID z DOM)
      const message = Gmail.Users.Messages.get('me', messageId, { format: 'full' });

      if (!message || !message.threadId) {
        Logger.log('fetchThreadFull: Gmail API nie zwrócił threadId dla messageId: ' + messageId);
        return {
          success: false,
          error: 'Gmail API nie zwrócił threadId dla podanego messageId.'
        };
      }

      const apiThreadId = message.threadId;
      Logger.log('fetchThreadFull: Pobrany apiThreadId z Gmail API: ' + apiThreadId);

      // 2) Pobierz cały wątek używając threadId z API (NIE z URL)
      const thread = Gmail.Users.Threads.get('me', apiThreadId);

      if (thread && thread.messages) {
        Logger.log('fetchThreadFull: Wątek pobrany, liczba wiadomości: ' + thread.messages.length);

        const messages = thread.messages.map(msg => {
          const payload = msg.payload;
          const headers = payload.headers || [];

          const getHeader = (name) => {
            const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
            return header ? header.value : '';
          };

          let plainBody = '';

          // Najpierw sprawdź body.data
          if (payload.body && payload.body.data) {
            try {
              plainBody = Utilities.newBlob(Utilities.base64DecodeWebSafe(payload.body.data)).getDataAsString();
            } catch (e) {
              Logger.log('Błąd dekodowania body.data: ' + e);
            }
          }

          // Jeśli nie ma body.data, szukaj w parts
          if (!plainBody && payload.parts) {
            for (let i = 0; i < payload.parts.length; i++) {
              const part = payload.parts[i];
              if (part.mimeType === 'text/plain' && part.body && part.body.data) {
                try {
                  plainBody = Utilities.newBlob(Utilities.base64DecodeWebSafe(part.body.data)).getDataAsString();
                  break;
                } catch (e) {
                  Logger.log('Błąd dekodowania part: ' + e);
                }
              }
            }
          }

          return {
            messageId: msg.id,
            threadId: msg.threadId,
            subject: getHeader('Subject'),
            from: getHeader('From'),
            to: getHeader('To'),
            date: getHeader('Date'),
            snippet: msg.snippet || '',
            plainBody: plainBody
          };
        });

        return {
          // Zwracamy oba identyfikatory: UI threadId (z URL) oraz apiThreadId z Gmail API
          success: true,
          threadId: threadId || apiThreadId, // dla spójności z currentState.threadId
          apiThreadId: apiThreadId,
          messageCount: messages.length,
          messages: messages
        };
      }

      return {
        success: false,
        error: 'Gmail API nie zwrócił wiadomości dla wątku (apiThreadId: ' + apiThreadId + ').'
      };

    } catch (gmailApiError) {
      Logger.log('fetchThreadFull: Błąd Gmail API (Messages/Threads): ' + gmailApiError.toString());
      return {
        success: false,
        error: 'Nie można pobrać wątku po messageId: ' + gmailApiError.toString()
      };
    }

  } catch (error) {
    Logger.log('Błąd fetchThreadFull: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}
```

### Routing w `doPost(e)`

**Plik:** `G_APP_backend/Kod.js`

```265:289:G_APP_backend/Kod.js
// Endpoint doPOST - odbiera logi z rozszerzenia Chrome + ETAP 2: Gmail API calls
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    // ========== ETAP 2: Gmail API Routing ==========
    if (data.action) {
      let result;
      
      if (data.action === 'fetch-message-simple') {
        result = fetchMessageSimple(data.messageId, data.threadId);
      } else if (data.action === 'fetch-message-full') {
        result = fetchMessageFull(data.messageId, data.threadId);
      } else if (data.action === 'fetch-thread-full') {
        result = fetchThreadFull(data.threadId, data.messageId);
      } else {
        result = {
          success: false,
          error: 'Nieznana akcja: ' + data.action
        };
      }
      
      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // ========== ETAP 1: Logowanie (jak było) ==========
    // ... kod saveLogToDrive ...
  }
}
```

### Konfiguracja Gmail API (Advanced Service)

**Plik:** `G_APP_backend/appsscript.json`

Aby `fetchThreadFull` działała (używa `Gmail.Users.Messages.get` i `Gmail.Users.Threads.get`), muszą być spełnione dwa warunki:

1. **W edytorze Apps Script** w zakładce **Usługi** dodana usługa **Gmail API** z identyfikatorem `Gmail`.
2. **W pliku `appsscript.json`** wpis:

```1:14:G_APP_backend/appsscript.json
{
  "timeZone": "Europe/Warsaw",
  "dependencies": {
    "enabledAdvancedServices": [
      {
        "userSymbol": "Gmail",
        "version": "v1",
        "serviceId": "gmail"
      }
    ]
  },
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
```

**Dlaczego to ważne:**
- Bez tego `clasp push` usuwa konfigurację usługi z serwera
- Bez tego `Gmail` jest `undefined` → `ReferenceError: Gmail is not defined`
- Dzięki temu pełne pobieranie wątku działa stabilnie

---

## Flow danych

### AUTO-FETCH (mail_opened)

```
1. Content → Background: gmail-state-changed {stan: mail_opened, messageId, threadId}
2. Background: callGAS('fetch-message-simple')
3. GAS: fetchMessageSimple() → zwraca {subject, from, snippet}
4. Background → Sidepanel: auto-mail-data {data}
5. Sidepanel: displayFetchedData() → sprawdza messageId, wyświetla
```

### MANUAL-FETCH (kliknięcie Message ID)

```
1. User klika Message ID w sidepanel
2. Sidepanel → Background: manual-fetch-message {messageId, threadId}
3. Background: callGAS('fetch-message-full')
4. GAS: fetchMessageFull() → zwraca pełne dane
5. Background → Sidepanel: full-message-ready {data}
6. Sidepanel: displayFetchedData() → sprawdza messageId, wyświetla
```

### MANUAL-FETCH (kliknięcie Thread ID)

```
1. User klika Thread ID w sidepanel
2. Sidepanel → Background: manual-fetch-thread {threadId}
3. Background: callGAS('fetch-thread-full')
4. GAS: fetchThreadFull() → zwraca tablicę wiadomości
5. Background → Sidepanel: full-thread-ready {data}
6. Sidepanel: displayFetchedData() → sprawdza threadId, wyświetla
```

---

## Weryfikacja aktualności danych

Sidepanel **zawsze** sprawdza czy dane są aktualne przed wyświetleniem:

```javascript
function displayFetchedData(data, type) {
  // Ignoruj jeśli messageId się nie zgadza
  if (type === 'message' && data.messageId !== currentState?.messageId) {
    console.log('Ignoruję nieaktualne dane');
    return;
  }
  
  // Ignoruj jeśli threadId się nie zgadza
  if (type === 'thread' && data.threadId !== currentState?.threadId) {
    console.log('Ignoruję nieaktualne dane');
    return;
  }
  
  // OK - dane aktualne
  fetchedDataSection.style.display = 'block';
  fetchedData.textContent = JSON.stringify(data, null, 2);
}
```

**Scenariusz:** User otwiera mail A, system robi auto-fetch, ale zanim odpowiedź wróci, user przechodzi do mail B. Sidepanel otrzyma dane dla mail A, ale zignoruje je bo `currentState.messageId` już wskazuje na mail B.

---

## Testowanie

### 1. Wdróż GAS WebApp

```bash
cd G_APP_backend
clasp push
clasp version "ETAP 2: Auto + Manual Fetch"
clasp deploy -i <DEPLOYMENT_ID>
```

Upewnij się że:
- Deployment ma "Execute as: Me"
- "Who has access: Anyone"
- Gmail API jest włączone w projekcie GCP

### 2. Wklej URL do `background.js`

```javascript
const GAS_WEB_APP_URL = 'https://script.google.com/a/macros/.../exec';
```

### 3. Przeładuj rozszerzenie

1. `chrome://extensions` → reload ZCRM CCE2
2. Odśwież Gmail (F5)

### 4. Test AUTO-FETCH

1. Otwórz dowolny mail w Gmailu
2. Otwórz sidepanel
3. Sprawdź czy w sekcji "Pobrane dane" pojawił się snippet

### 5. Test MANUAL-FETCH (Message)

1. Kliknij na Message ID w sidepanel
2. Sprawdź czy pojawią się pełne dane wiadomości

### 6. Test MANUAL-FETCH (Thread)

1. Kliknij na Thread ID w sidepanel
2. Sprawdź czy pojawią się dane całego wątku

### 7. Test weryfikacji

1. Otwórz mail A
2. Kliknij Message ID (rozpoczyna fetch)
3. **Natychmiast** otwórz mail B
4. Sprawdź logi - dane mail A powinny być zignorowane

---

## Podsumowanie

**ETAP 2 DODAJE:**
- ✅ Klikalne Message ID i Thread ID
- ✅ Auto-fetch przy mail_opened
- ✅ Manual-fetch pełnych danych
- ✅ 3 endpointy GAS (simple, full-message, full-thread)
- ✅ Weryfikację aktualności danych
- ✅ Nieblokujący UI fetch

**ETAP 1 POZOSTAJE NIETKNIĘTY:**
- ✅ Content script działa tak samo
- ✅ System stanów działa tak samo
- ✅ Logowanie do Drive działa tak samo

---

## ETAP 2* – Rozszerzenia i optymalizacje

### Przegląd zmian

ETAP 2* wprowadza **Thread Intelligence Layer** - inteligentny system optymalizacji pobierania danych:

**Kluczowe zmiany:**
1. ✅ **AUTO-FETCH** pobiera **pełną wiadomość** (nie snippet)
2. ✅ **Thread Intelligence** - sprawdza `messageCount` przed pobraniem (20-50ms)
3. ✅ **Cache wątków** - ponowne kliknięcie = 0ms (bez API call)
4. ✅ **Timery wydajności** - szczegółowe metryki w logach
5. ✅ **Przycisk "Pobierz wątek"** zamiast klikalnych ID
6. ✅ **Smart UI** - przycisk disabled gdy wątek ma 1 wiadomość

---

### 1. Thread Intelligence Layer (Optymalizacja)

#### Problem:
- ~60% wątków w Gmail ma tylko **1 wiadomość**
- Pobieranie pełnego wątku w takim przypadku = **zmarnowane 2100ms + niepotrzebne API call**

#### Rozwiązanie:

**Nowy endpoint GAS:** `get-thread-metadata`

```javascript
function getThreadMetadata(messageId) {
  const message = GmailApp.getMessageById(messageId);
  const thread = message.getThread();
  const messageCount = thread.getMessageCount(); // SZYBKIE - bez ciał wiadomości
  
  return {
    success: true,
    messageId: messageId,
    threadId: thread.getId(),
    messageCount: messageCount,
    hasMultipleMessages: messageCount > 1
  };
}
```

**Czas wykonania:** 20-50ms (vs 2100ms dla pełnego wątku)

**Flow:**
```
AUTO-FETCH
  ↓
Pobiera pełną wiadomość (2000ms)
  ↓
W tle wywołuje get-thread-metadata (35ms)
  ↓
messageCount = 1 → przycisk disabled "ℹ️ Wątek ma tylko 1 wiadomość"
messageCount > 1 → przycisk active "🧵 Pobierz cały wątek (3 wiadomości)"
```

---

### 2. AUTO-FETCH jako pełna wiadomość

**PRZED (ETAP 2):**
```javascript
callGAS('fetch-message-simple') → snippet 200 znaków
```

**PO (ETAP 2*):**
```javascript
callGAS('fetch-message-full') → pełna wiadomość (plainBody, htmlBody, attachments)
```

**Konfiguracja w `background.js`:**
```javascript
// ETAP 2*: Konfiguracja auto-fetch (true = włączony, false = wyłączony)
const AUTO_FETCH_ENABLED = true;
```

**Zmień na `false`** aby wyłączyć automatyczne pobieranie przy otwarciu maila.

---

### 3. State Machine w Sidepanel

**Nowa zmienna:** `threadState`

```javascript
let threadState = {
  currentView: 'auto' | 'message' | 'thread',
  currentMessageId: null,
  currentThreadId: null,
  messageMetadataLoaded: false,
  threadMetadataLoaded: false,
  threadFullLoaded: false,
  messageCount: 0,
  cachedThreads: {}  // { threadId: data }
};
```

**Funkcje zarządzania:**

```javascript
function resetThreadState() {
  threadState.messageMetadataLoaded = false;
  threadState.threadMetadataLoaded = false;
  threadState.threadFullLoaded = false;
  threadState.messageCount = 0;
  threadState.currentView = 'auto';
  // Reset przycisku
  fetchThreadBtn.textContent = '🧵 Pobierz cały wątek';
  fetchThreadBtn.disabled = false;
}
```

---

### 4. Inteligentny przycisk "Pobierz wątek"

**UI (`sidepanel.html`):**

```html
<!-- Message ID i Thread ID = tylko wyświetlanie (NIE przyciski) -->
<div class="info-row">
  <div class="label">Message ID:</div>
  <div class="value" id="messageId">
    <span class="no-data">Nie wykryto</span>
  </div>
</div>

<div class="info-row">
  <div class="label">Thread ID:</div>
  <div class="value" id="threadId">
    <span class="no-data">-</span>
  </div>
</div>

<!-- Nowy przycisk -->
<div class="info-row">
  <button id="fetchThreadBtn" class="fetch-btn" style="display: none;">
    🧵 Pobierz cały wątek
  </button>
</div>
```

**Logika kliknięcia (3-poziomowa weryfikacja):**

```javascript
fetchThreadBtn.addEventListener('click', () => {
  // POZIOM 1: Cache - jeśli wątek już pobrany
  if (threadState.cachedThreads[currentState.threadId]) {
    console.log('💾 Wątek już pobrany - wyświetlam z cache');
    displayFetchedData(cachedData, 'thread');
    return; // STOP - 0ms API
  }

  // POZIOM 2: Thread Intelligence - jeśli tylko 1 wiadomość
  if (threadState.messageCount === 1) {
    fetchedData.textContent = 'ℹ️ Ten wątek zawiera tylko jedną wiadomość.\n' +
      'Pełna treść jest już wyświetlona powyżej (AUTO-FETCH).\n' +
      'Pobieranie całego wątku nie wniesie dodatkowych danych.';
    return; // STOP - 0ms API
  }

  // POZIOM 3: OK - pobierz pełny wątek
  console.log('🚀 Pobieranie pełnego wątku, messageCount:', threadState.messageCount);
  callGAS('fetch-thread-full');
});
```

**Stany przycisku:**

| Stan | Tekst przycisku | Disabled |
|------|-----------------|----------|
| Początkowy | `🧵 Pobierz cały wątek` | Nie |
| Po metadata (>1) | `🧵 Pobierz cały wątek (3 wiadomości)` | Nie |
| Po metadata (=1) | `ℹ️ Wątek ma tylko 1 wiadomość` | Tak |
| Po pobraniu | `✅ Cały wątek pobrany (3 wiadomości)` | Tak |

---

### 5. Timery wydajności (Performance Metrics)

**Background.js - mierzenie czasu GAS:**

```javascript
async function callGAS(action, params) {
  const startTime = performance.now();
  // ... fetch ...
  const fetchTime = performance.now() - startTime;
  const dataSize = new Blob([text]).size;
  
  console.log(`[Background] Odpowiedź z GAS (${action}): ${fetchTime}ms, ${dataSize} bytes`);
  backgroundLogger.info(`📊 Performance GAS (${action})`, {
    fetchTime: `${fetchTime}ms`,
    dataSize: `${dataSize} bytes`,
    messageId: params.messageId,
    threadId: params.threadId
  });
}
```

**Przykładowe logi:**

```
🚀 AUTO-FETCH-FULL START: 19ab256bf212d825
📊 Performance GAS (fetch-message-full): 1968ms, 83468 bytes
✅ AUTO-FETCH-FULL COMPLETE: 1970ms, 14374 chars
📊 AUTO-FETCH-FULL Total Time: 1970ms, bodyLength: 14374, attachments: 2

🧠 Thread Intelligence: sprawdzam messageCount...
📊 Thread Metadata Check: 35ms, messageCount=3, hasMultipleMessages=true

🧵 MANUAL-THREAD-FETCH START: FMfcgzQcqthzjrbTMCMRbNVmvJlqXhJF
📊 Performance GAS (fetch-thread-full): 2119ms, 1514 bytes
✅ MANUAL-THREAD-FETCH COMPLETE: 2120ms, 3 messages
📊 MANUAL-THREAD-FETCH Total Time: 2120ms, messageCount: 3
```

**Sidepanel.js - mierzenie renderowania:**

```javascript
function displayFetchedData(data, type) {
  const startTime = performance.now();
  // ... render JSON ...
  const renderTime = performance.now() - startTime;
  const dataSize = new Blob([jsonString]).size;
  
  console.log(`[Sidepanel] 📊 Wyświetlono dane (${type}): ${renderTime}ms, ${dataSize} bytes`);
  sidepanelLogger.info(`📊 Performance Display (${type})`, {
    renderTime: `${renderTime}ms`,
    dataSize: `${dataSize} bytes`,
    messageCount: data.messageCount || 1
  });
}
```

---

### 6. Metryki do analizy

**W logach Drive znajdziesz:**

| Metryka | Znaczenie | Przykład |
|---------|-----------|----------|
| `fetchTime` | Czas pobierania z GAS | `1968ms` |
| `dataSize` | Rozmiar odpowiedzi JSON | `83468 bytes` |
| `bodyLength` | Długość plainBody | `14374 chars` |
| `messageCount` | Liczba wiadomości w wątku | `3` |
| `attachments` | Liczba załączników | `2` |
| `totalTime` | Całkowity czas operacji | `1970ms` |
| `renderTime` | Czas renderowania UI | `0.7ms` |

**Typy operacji:**
- `AUTO-FETCH-FULL` - automatyczne pobieranie pełnej wiadomości
- `MANUAL-THREAD-FETCH` - ręczne pobieranie wątku (przycisk)
- `Thread Metadata Check` - sprawdzenie messageCount (20-50ms)
- `Performance Display` - renderowanie w sidepanel

---

### 7. Optymalizacje wydajności

#### **A. Unikanie niepotrzebnych API calls:**

| Scenariusz | PRZED (ETAP 2) | PO (ETAP 2*) |
|------------|----------------|--------------|
| Wątek z 1 wiadomością | 2100ms API call | 0ms (info) |
| Ponowne kliknięcie wątku | 2100ms API call | 0ms (cache) |
| Sprawdzenie messageCount | ❌ nie było | 35ms |

#### **B. Oszczędności:**

- **~60% wątków** ma 1 wiadomość → **0 niepotrzebnych fetch-thread-full**
- **Cache** → 2+ kliknięcie = **0ms zamiast 2100ms**
- **Metadata check** → **98% szybciej** niż full fetch

#### **C. Flow decyzyjny przycisku:**

```
User klika "Pobierz wątek"
    ↓
Sprawdź cache
    ├→ TAK → wyświetl (0ms) ✅
    └→ NIE ↓
         Sprawdź messageCount
             ├→ = 1 → pokaż info (0ms) ✅
             └→ > 1 → fetch-thread-full (2100ms) ✅
                       ↓
                   Zapisz w cache
```

---

### 8. Nowe message types

**Background → Sidepanel:**

| Type | Cel | Dane |
|------|-----|------|
| `auto-mail-data` | Pełna wiadomość (auto) | Wszystkie pola + attachments |
| `thread-metadata` | Szybkie info o wątku | messageCount, hasMultipleMessages |
| `full-thread-ready` | Pełny wątek (manual) | Tablica wiadomości |
| `state-update` | Aktualizacja stanu Gmail | stan, messageId, threadId |

**Usunięte:**
- ❌ `full-message-ready` - auto-fetch już pobiera full

---

### 9. Routing GAS (zaktualizowany)

**Plik:** `G_APP_backend/Kod.js`

```javascript
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  
  if (data.action) {
    let result;
    
    // AUTO i MANUAL-MESSAGE → oba używają fetch-message-full
    if (data.action === 'fetch-message-simple' || data.action === 'fetch-message-full') {
      result = fetchMessageFull(data.messageId, data.threadId);
    } 
    // Thread Intelligence - szybkie metadata (20-50ms)
    else if (data.action === 'get-thread-metadata') {
      result = getThreadMetadata(data.messageId);
    } 
    // Pełny wątek (tylko jeśli messageCount > 1)
    else if (data.action === 'fetch-thread-full') {
      result = fetchThreadFull(data.threadId, data.messageId);
    }
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

---

### 10. Nowa funkcja GAS: `getThreadMetadata()`

**Cel:** Szybkie sprawdzenie czy wątek ma wiele wiadomości (bez pobierania ciał)

**Kod:**
```javascript
function getThreadMetadata(messageId) {
  const message = GmailApp.getMessageById(messageId);
  const thread = message.getThread();
  const messageCount = thread.getMessageCount(); // BEZ pobierania treści
  
  return {
    success: true,
    messageId: messageId,
    threadId: thread.getId(),
    messageCount: messageCount,
    hasMultipleMessages: messageCount > 1
  };
}
```

**Czas:** 20-50ms  
**Oszczędność:** ~98% vs pełny fetch-thread-full

---

### 11. Zaktualizowany flow danych

#### **AUTO-FETCH-FULL (mail_opened) + Thread Intelligence:**

```
1. Content → Background: gmail-state-changed {stan: mail_opened, messageId, threadId}
2. Background: 
   A. callGAS('fetch-message-full') → pełna wiadomość
   B. callGAS('get-thread-metadata') → messageCount (20-50ms)
3. GAS: 
   A. fetchMessageFull() → zwraca pełne dane
   B. getThreadMetadata() → zwraca messageCount
4. Background → Sidepanel:
   A. auto-mail-data {pełna wiadomość}
   B. thread-metadata {messageCount}
5. Sidepanel: 
   A. displayFetchedData() → wyświetla pełne dane
   B. Aktualizuje przycisk wg messageCount
```

#### **MANUAL-FETCH-THREAD (kliknięcie przycisku):**

```
1. User klika "Pobierz cały wątek"
2. Sidepanel sprawdza:
   - Cache? → wyświetl z cache (0ms) ✅ STOP
   - messageCount = 1? → pokaż info (0ms) ✅ STOP
   - messageCount > 1? → kontynuuj ↓
3. Sidepanel → Background: manual-fetch-thread {threadId, messageId}
4. Background: callGAS('fetch-thread-full')
5. GAS: fetchThreadFull() → zwraca tablicę wiadomości
6. Background → Sidepanel: full-thread-ready {data}
7. Sidepanel: 
   - Zapisuje w cache
   - Zmienia przycisk na "✅ Cały wątek pobrany"
   - displayFetchedData() → wyświetla
```

---

### 12. CSS dla przycisku

**Plik:** `chrome_extension/sidepanel.html`

```css
.fetch-btn {
  width: 100%;
  padding: 10px 15px;
  background-color: #1a73e8;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s;
}

.fetch-btn:hover {
  background-color: #1557b0;
}

.fetch-btn:disabled {
  background-color: #ccc;
  cursor: not-allowed;
}
```

---

### 13. Przykładowe metryki z logów

**Log AUTO-FETCH-FULL:**
```
[2025-11-27 15:06:01] Background: 
[INFO] 🚀 AUTO-FETCH-FULL START: 19ab256bf212d825
[INFO] 📊 Performance GAS (fetch-message-full): 1968ms, 83468 bytes
[INFO] ✅ AUTO-FETCH-FULL COMPLETE: 1970ms, 14374 chars
[INFO] 📊 AUTO-FETCH-FULL Total Time: 1970ms, bodyLength: 14374, attachments: 0

[INFO] 🧠 Thread Intelligence: sprawdzam messageCount...
[INFO] 📊 Thread Metadata Check: 35ms, messageCount=1, hasMultipleMessages=false
```

**Log MANUAL-THREAD-FETCH (messageCount > 1):**
```
[2025-11-27 15:06:11] Background:
[INFO] 🧵 MANUAL-THREAD-FETCH START: KtbxLwHDhGbjmBNrmWJkBSWJSnzKhkstkL
[INFO] 📊 Performance GAS (fetch-thread-full): 2124ms, 1514 bytes
[INFO] ✅ MANUAL-THREAD-FETCH COMPLETE: 2125ms, 2 messages
[INFO] 📊 MANUAL-THREAD-FETCH Total Time: 2125ms, messageCount: 2

[INFO] Sidepanel: 💾 Wątek zapisany w cache
[INFO] Sidepanel: 📊 Performance Display (thread): 0.1ms, 1686 bytes
```

**Log ponownego kliknięcia (cache):**
```
[INFO] Sidepanel: 💾 Wątek już pobrany - wyświetlam z cache
[INFO] Sidepanel: 📊 Performance Display (thread): 0.1ms, 1686 bytes
```

---

### 14. Kontrola aktualności wyników (ETAP 2*)

**Problem:** User zmienia mail w trakcie pobierania → stare dane mogą być wyświetlone.

**Rozwiązanie:**

```javascript
function updateUI(state) {
  const previousState = currentState;
  const shouldReset = 
    !state || 
    state.stan !== 'mail_opened' || 
    (previousState && state.messageId !== previousState.messageId) ||
    (previousState && state.threadId !== previousState.threadId);

  if (shouldReset) {
    resetFetchedData();
    resetThreadState();
  }
}

function displayFetchedData(data, type) {
  // Weryfikacja aktualności
  if (type === 'message' && data.messageId !== currentState?.messageId) {
    console.log('Ignoruję nieaktualne dane');
    resetFetchedData();
    return; // STOP
  }
  
  // OK - wyświetl
  fetchedDataSection.style.display = 'block';
  fetchedData.textContent = JSON.stringify(data, null, 2);
}
```

**Skutek:**
- ✅ Wyniki są czyszczone przy zmianie maila
- ✅ Nieaktualne dane są ignorowane
- ✅ UI zawsze pokazuje dane dla aktualnego maila

---

### 15. Podsumowanie ETAP 2*

**Dodano:**
- ✅ Thread Intelligence Layer (messageCount check: 20-50ms)
- ✅ Cache dla wątków (ponowne kliknięcie = 0ms)
- ✅ Auto-fetch jako pełna wiadomość
- ✅ Przycisk "Pobierz wątek" z inteligentną logiką
- ✅ Timery wydajności (fetchTime, renderTime, dataSize)
- ✅ State machine w sidepanel
- ✅ Kontrola aktualności wyników
- ✅ Opcjonalny auto-fetch (konfiguracja)

**Usunięto:**
- ❌ Klikalne Message ID (auto-fetch wystarczy)
- ❌ Klikalne Thread ID (zastąpione przyciskiem)
- ❌ fetchMessageSimple (snippet) - wszystko jako full

**Optymalizacje:**
- 🚀 ~60% mniej API calls (wątki z 1 wiadomością)
- 🚀 ~98% szybciej sprawdzenie messageCount (35ms vs 2100ms)
- 🚀 0ms dla cache (ponowne wyświetlenie)
- 🚀 Szczegółowe metryki wydajności

**ETAP 1 nadal nietknięty:**
- ✅ Content script bez zmian
- ✅ System stanów bez zmian
- ✅ Logger bez zmian

