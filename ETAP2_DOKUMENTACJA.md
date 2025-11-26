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

**Dodano:**

1. **Zmienna `currentState`** – przechowuje aktualny stan Gmaila do weryfikacji

```javascript
let currentState = null;
```

2. **Click listeners** – Message ID i Thread ID

```javascript
messageIdElement.addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'manual-fetch-message',
    messageId: currentState.messageId,
    threadId: currentState.threadId
  });
});

threadIdElement.addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'manual-fetch-thread',
    threadId: currentState.threadId
  });
});
```

3. **Funkcja `displayFetchedData()`** – wyświetla dane z weryfikacją

```javascript
function displayFetchedData(data, type) {
  // Ignoruj jeśli dane nieaktualne
  if (type === 'message' && data.messageId !== currentState?.messageId) {
    return;
  }
  if (type === 'thread' && data.threadId !== currentState?.threadId) {
    return;
  }
  
  fetchedDataSection.style.display = 'block';
  fetchedData.textContent = JSON.stringify(data, null, 2);
}
```

4. **3 nowe message listeners**:

```javascript
// Auto-fetch
if (message.type === 'auto-mail-data') {
  displayFetchedData(message.data, 'message');
}

// Manual message fetch
if (message.type === 'full-message-ready') {
  displayFetchedData(message.data, 'message');
}

// Manual thread fetch
if (message.type === 'full-thread-ready') {
  displayFetchedData(message.data, 'thread');
}
```

---

## 2. Background (ETAP 2)

### Dodano:

1. **`GAS_WEB_APP_URL`** – URL do GAS WebApp

```javascript
const GAS_WEB_APP_URL = 'https://script.google.com/.../exec';
```

2. **Funkcja `callGAS(action, params)`** – komunikacja z GAS

```javascript
async function callGAS(action, params) {
  const response = await fetch(GAS_WEB_APP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params })
  });
  
  return await response.json();
}
```

3. **Auto-fetch w `gmail-state-changed`**

```javascript
if (message.data.stan === 'mail_opened' && message.data.messageId) {
  callGAS('fetch-message-simple', {
    messageId: message.data.messageId,
    threadId: message.data.threadId
  }).then(result => {
    if (result.success) {
      chrome.runtime.sendMessage({
        type: 'auto-mail-data',
        data: result
      });
    }
  });
}
```

4. **Manual-fetch-message listener**

```javascript
if (message.type === 'manual-fetch-message') {
  callGAS('fetch-message-full', {
    messageId: message.messageId,
    threadId: message.threadId
  }).then(result => {
    if (result.success) {
      chrome.runtime.sendMessage({
        type: 'full-message-ready',
        data: result
      });
    }
  });
}
```

5. **Manual-fetch-thread listener**

```javascript
if (message.type === 'manual-fetch-thread') {
  callGAS('fetch-thread-full', {
    threadId: message.threadId
  }).then(result => {
    if (result.success) {
      chrome.runtime.sendMessage({
        type: 'full-thread-ready',
        data: result
      });
    }
  });
}
```

---

## 3. GAS WebApp (ETAP 2)

### Dodano 3 funkcje Gmail API:

#### 1. `fetchMessageSimple(messageId, threadId)`

**Cel:** Szybki auto-fetch (minimalne dane)

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
```javascript
function fetchMessageSimple(messageId, threadId) {
  const message = GmailApp.getMessageById(messageId);
  
  return {
    success: true,
    messageId,
    threadId,
    subject: message.getSubject(),
    from: message.getFrom(),
    date: message.getDate().toISOString(),
    snippet: message.getPlainBody().substring(0, 200)
  };
}
```

#### 2. `fetchMessageFull(messageId, threadId)`

**Cel:** Pełne dane wiadomości (manual-fetch)

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

#### 3. `fetchThreadFull(threadId)`

**Cel:** Pełny wątek (manual-fetch)

**Zwraca:**
```javascript
{
  success: true,
  threadId,
  messageCount,
  firstMessageDate,
  lastMessageDate,
  messages: [
    {messageId, subject, from, date, snippet}
  ]
}
```

### Routing w `doPost(e)`

```javascript
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  
  // ETAP 2: Gmail API routing
  if (data.action) {
    if (data.action === 'fetch-message-simple') {
      return fetchMessageSimple(data.messageId, data.threadId);
    }
    if (data.action === 'fetch-message-full') {
      return fetchMessageFull(data.messageId, data.threadId);
    }
    if (data.action === 'fetch-thread-full') {
      return fetchThreadFull(data.threadId);
    }
  }
  
  // ETAP 1: Logowanie (jak było)
  return saveLogToDrive(data);
}
```

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

