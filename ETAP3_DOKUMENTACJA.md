# ETAP 3 – Cache + Thread Intelligence (Dokumentacja)

## Przegląd

ETAP 3 buduje na ETAP 2 i ETAP 2* dodając:

- **Dwuwarstwowy cache** po stronie `background.js`:
  - **Thread Cache** – wie, jakie `messageId` należą do danego `threadId`.
  - **Message Cache** – wie, czy dana wiadomość była już pobrana / analizowana.
- **Rozszerzenie Thread Intelligence**:
  - szybkie pobieranie metadanych wątku (`get-thread-metadata`) z listą `messageIds`,
  - aktualizacja cache przy AUTO-FETCH i MANUAL-FETCH-THREAD,
  - informowanie UI, czy **pełny wątek był już kiedyś pobrany**.
- Pełna zgodność z:
  - **ETAP 1** – system stanów, logger, otwieranie sidepanelu,
  - **ETAP 2 / 2*** – Auto-FULL-message + Manual-Thread + kontrola aktualności.

---

## 1. Background – dwuwarstwowy cache

### Plik: `chrome_extension/background.js`

### 1.1. Struktury cache

```javascript
// ETAP 1: aktualny stan
let currentState = null;

// ETAP 2*: Dwuwarstwowy cache (pamięć + chrome.storage.local)
let threadCache = {};   // { threadId: { messageIds: [], lastSyncedAt, hasFullThreadFetched } }
let messageCache = {};  // { messageId: { threadId, processed, hasAnalysis, lastFetchedAt } }
```

**Thread Cache (`threadCache[threadId]`):**
- `messageIds: string[]` – pełna lista `messageId` z Gmaila (UI threadId),
- `lastSyncedAt: number` – `Date.now()` ostatniej synchronizacji z Gmail,
- `hasFullThreadFetched: boolean` – czy ten wątek był już kiedyś pobrany jako pełny (`fetch-thread-full`).

**Message Cache (`messageCache[messageId]`):**
- `threadId: string` – `threadId` z UI, do którego należy wiadomość,
- `processed: boolean` – czy ta wiadomość była już pobrana (`fetch-message-full` lub wątkiem),
- `hasAnalysis: boolean` – czy powstał JSON z analizy LLM (na przyszłość),
- `lastFetchedAt: number | null` – ostatni czas pobrania treści.

---

### 1.2. Operacje na cache

```javascript
async function loadCacheFromStorage() {
  const result = await chrome.storage.local.get(['threadCache', 'messageCache']);
  threadCache = result.threadCache || {};
  messageCache = result.messageCache || {};
}

async function saveCacheToStorage() {
  await chrome.storage.local.set({
    threadCache: threadCache,
    messageCache: messageCache
  });
}

function updateMessageCache(messageId, threadId, processed = true) {
  messageCache[messageId] = {
    threadId,
    processed,
    hasAnalysis: false,
    lastFetchedAt: Date.now()
  };
}

function updateThreadCache(threadId, messageIds, hasFullThreadFetched = false) {
  const existing = threadCache[threadId] || {};
  threadCache[threadId] = {
    messageIds,
    lastSyncedAt: Date.now(),
    hasFullThreadFetched: existing.hasFullThreadFetched || hasFullThreadFetched
  };
}
```

**Ładowanie cache (`loadCacheFromStorage`)** – wykonywane przy starcie service workera:

```javascript
console.log('[Background] Service worker uruchomiony (ETAP 2*: Auto-Full + Manual-Thread)');
loadCacheFromStorage();
```

**Zapisywanie cache (`saveCacheToStorage`)** – po każdej istotnej zmianie:
- zapisuje obie mapy,
- loguje liczbę wątków, wiadomości i `processed`.

---

## 2. GAS – rozszerzony `getThreadMetadata`

### Plik: `G_APP_backend/Kod.js`

### 2.1. Funkcja `getThreadMetadata(messageId)`

ETAP 3 rozszerza funkcję z ETAP 2* – oprócz `messageCount` zwracana jest pełna lista `messageIds`:

```javascript
// ETAP 3: Thread Intelligence - szybkie sprawdzenie + lista messageIds
function getThreadMetadata(messageId) {
  const message = GmailApp.getMessageById(messageId);
  const thread = message.getThread();

  const messageCount = thread.getMessageCount();
  const messages = thread.getMessages(); // bez pobierania ciał

  const messageIds = messages.map(msg => msg.getId());

  return {
    success: true,
    messageId,
    threadId: thread.getId(),
    messageCount,
    hasMultipleMessages: messageCount > 1,
    messageIds // pełna lista messageIds w wątku
  };
}
```

**Charakterystyka:**
- czas ~20–50 ms,
- brak pobierania treści (`plainBody`),
- minimalny narzut na Gmail API.

### 2.2. Routing `doPost(e)` (przypomnienie)

```javascript
if (data.action === 'fetch-message-simple' || data.action === 'fetch-message-full') {
  result = fetchMessageFull(data.messageId, data.threadId);
} else if (data.action === 'get-thread-metadata') {
  result = getThreadMetadata(data.messageId);
} else if (data.action === 'fetch-thread-full') {
  result = fetchThreadFull(data.threadId, data.messageId);
}
```

---

## 3. AUTO-FETCH – integracja z cache

### 3.1. Warunki startu

```javascript
if (AUTO_FETCH_ENABLED &&
    message.data.stan === 'mail_opened' &&
    message.data.messageId) {
  // ... AUTO-FETCH-FULL ...
}
```

AUTO-FETCH działa, gdy:
- stan z content script = `mail_opened`,
- istnieje `messageId` i `threadId`,
- flaga `AUTO_FETCH_ENABLED` = `true`.

### 3.2. Krok 1 – sprawdzenie `messageCache`

```javascript
const msgId = message.data.messageId;
const tId = message.data.threadId;

const cached = messageCache[msgId];
const shouldFetch = !cached || !cached.processed;

if (cached && cached.processed) {
  console.log('[Background] 💾 Wiadomość już pobrana (cache), skip fetch:', msgId);
}
```

- Jeśli `processed = true` → **pomijamy ponowny fetch pełnej wiadomości**.
- Jeśli brak wpisu lub `processed = false` → pobieramy pełną wiadomość.

### 3.3. Krok 1A – Auto-FULL-message (warunkowy)

```javascript
const fetchPromise = shouldFetch
  ? callGAS('fetch-message-full', { messageId: msgId, threadId: tId })
  : Promise.resolve(null);

fetchPromise.then(result => {
  if (result && result.success) {
    updateMessageCache(msgId, tId, true);
    saveCacheToStorage();

    chrome.runtime.sendMessage({
      type: 'auto-mail-data',
      data: result
    });
  }
  // ...
});
```

- Pełna wiadomość jest wysyłana do sidepanelu tylko gdy była faktycznie pobrana.

### 3.4. Krok 2 – Thread Intelligence + aktualizacja `threadCache`

Niezależnie od tego, czy pełna wiadomość była pobierana, **zawsze**:

```javascript
callGAS('get-thread-metadata', { messageId: msgId }).then(metadata => {
  if (metadata.success && metadata.messageIds) {
    const newIds = metadata.messageIds;
    // dopisz nowe messageIds do messageCache
    // zaktualizuj threadCache[threadId].messageIds
    // zapisz do storage
    // wyślij 'thread-metadata' do sidepanelu
  }
});
```

**Efekt:**
- `threadCache[threadId].messageIds` – zawsze spójne z Gmail,
- nowe `messageId` w wątku dostają wpis `processed: false` w `messageCache`,
- sidepanel dostaje informację o:
  - `messageCount`,
  - `hasMultipleMessages`,
  - **czy pełny wątek był już kiedykolwiek pobrany** (`wasFullThreadFetched`).

---

## 4. MANUAL-FETCH-THREAD – aktualizacja cache

### 4.1. Background – przetwarzanie pełnego wątku

```javascript
if (message.type === 'manual-fetch-thread') {
  const tId = message.threadId;
  const msgId = message.messageId || currentState?.messageId;

  callGAS('fetch-thread-full', { threadId: tId, messageId: msgId })
    .then(result => {
      if (result.success) {
        const messageIds = result.messages
          ? result.messages.map(msg => msg.messageId)
          : [msgId];

        // KROK 1: threadCache – oznaczamy pełny wątek
        updateThreadCache(tId, messageIds, true);

        // KROK 2: messageCache – wszystkie wiadomości jako processed=true
        if (result.messages && Array.isArray(result.messages)) {
          result.messages.forEach(msg => {
            if (msg.messageId) {
              updateMessageCache(msg.messageId, tId, true);
            }
          });
        }

        saveCacheToStorage();

        chrome.runtime.sendMessage({
          type: 'full-thread-ready',
          data: result
        });
      }
    });
}
```

**Najważniejsze:**
- `threadCache[threadId].hasFullThreadFetched = true` – od tego momentu wątek jest oznaczony jako „pełny wątek był kiedyś pobrany”.
- Każda wiadomość w `result.messages` ma `processed=true` i `lastFetchedAt=now`.

---

## 5. Sidepanel – wizualizacja historii pobierania

### Plik: `chrome_extension/sidepanel.js`

### 5.1. Rozszerzony `threadState`

```javascript
let threadState = {
  currentView: 'auto' | 'message' | 'thread',
  currentMessageId: null,
  currentThreadId: null,
  messageMetadataLoaded: false,
  threadMetadataLoaded: false,
  threadFullLoaded: false,
  messageCount: 0,
  hasFullThreadFetchedBefore: false, // NOWE
  cachedThreads: {} // { threadId: data }
};
```

**Reset stanu:**

```javascript
function resetThreadState() {
  threadState.messageMetadataLoaded = false;
  threadState.threadMetadataLoaded = false;
  threadState.threadFullLoaded = false;
  threadState.messageCount = 0;
  threadState.hasFullThreadFetchedBefore = false;
  threadState.currentView = 'auto';

  if (fetchThreadBtn) {
    fetchThreadBtn.textContent = '🧵 Pobierz cały wątek';
    fetchThreadBtn.disabled = false;
  }
}
```

### 5.2. Odbiór `thread-metadata` – informacja „już kiedyś pobrany”

```javascript
if (message.type === 'thread-metadata') {
  threadState.threadMetadataLoaded = true;
  threadState.messageCount = message.data.messageCount || 0;
  threadState.hasFullThreadFetchedBefore = !!message.data.wasFullThreadFetched;

  if (fetchThreadBtn && message.data.messageCount > 1) {
    let label = `🧵 Pobierz cały wątek (${message.data.messageCount} wiadomości)`;
    if (threadState.hasFullThreadFetchedBefore) {
      label += ' – już kiedyś pobrany';
    }
    fetchThreadBtn.textContent = label;
    fetchThreadBtn.disabled = false;
  } else if (fetchThreadBtn && message.data.messageCount === 1) {
    fetchThreadBtn.textContent = `ℹ️ Wątek ma tylko 1 wiadomość`;
    fetchThreadBtn.disabled = true;
  }
}
```

**Dzięki temu:**
- jeśli ETAP 3 rozpozna, że **pełny wątek był już kiedyś pobrany** (na podstawie `threadCache[threadId].hasFullThreadFetched`), przycisk pokazuje:

```text
🧵 Pobierz cały wątek (3 wiadomości – już kiedyś pobrany)
```

- po aktualnym pobraniu wątku (w tej sesji) przycisk zmienia tekst na:

```text
✅ Cały wątek pobrany (3 wiadomości)
```

co jasno sygnalizuje:
1. że dane są kompletne,
2. że były już pobierane również historycznie.

---

## 6. Wymagane uprawnienia i konfiguracja

### 6.1. `chrome_extension/manifest.json`

```json
"permissions": [
  "sidePanel",
  "storage"
],
"host_permissions": [
  "https://mail.google.com/*",
  "https://script.google.com/*"
]
```

**Nowe w ETAP 3:**  
- `storage` – wymagane dla `chrome.storage.local` (cache wątku i wiadomości).

### 6.2. GCP / GAS

ETAP 3 **nie dodaje nowych wymagań GCP** poza tym, co zostało opisane w:
- `ETAP1_DOKUMENTACJA.md` (Drive API, Web App),
- `ETAP2_DOKUMENTACJA.md` (Gmail API jako Advanced Service `Gmail`).

Główne zmiany dotyczą wyłącznie:
- logiki w `background.js`,
- funkcji `getThreadMetadata()` w GAS,
- dodatkowego stanu i tekstów w `sidepanel.js`.

---

## 7. Podsumowanie ETAP 3

**ETAP 3 DODAJE:**
- ✅ Dwuwarstwowy cache (thread + message) w `background.js`,
- ✅ Rozszerzony `getThreadMetadata()` z listą wszystkich `messageIds`,
- ✅ Warunkowe AUTO-FULL-message (skip jeśli w cache → mniej wywołań GAS),
- ✅ Synchronizację `threadCache` z Gmail po każdym AUTO-FETCH,
- ✅ Aktualizację cache po MANUAL-FETCH-THREAD,
- ✅ Informację w UI, czy **pełny wątek był już kiedyś pobrany**,
- ✅ Logi z licznikami cache (threads/messages/processed).

**ETAP 1 i ETAP 2 pozostają nietknięte:**
- ✅ System stanów Gmaila działa jak wcześniej,
- ✅ Logger i Web App do logów bez zmian,
- ✅ Architektura Auto-FULL-message + Manual-Thread z ETAP 2* działa identycznie – ETAP 3 tylko dokłada cache i telemetrię.


