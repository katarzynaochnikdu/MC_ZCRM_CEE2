# ETAP 4.0 – Warstwa LLM (Mock) – Dokumentacja

## Przegląd

ETAP 4.0 buduje na ETAP 1, 2, 2* i 3, dodając:

- **Analizę LLM** – nowy przepływ do ekstrakcji danych B2B (firmy, kontakty) z treści maili.
- **Mock JSON** – na tym etapie GAS zwraca **stały mock** w finalnym formacie. Prawdziwe wywołanie Gemini 2.5 Pro + Cloud Run będzie w **ETAP 4.1**.
- **Rozszerzenie cache** – `messageCache` teraz zawiera:
  - `analysisData: object | null` – JSON z analizy LLM,
  - `analyzedAt: number | null` – timestamp analizy.
- **Nowy UI** – przycisk "🤖 Analizuj LLM", sekcja z wynikami, ikonka ✓ przy `messageId` jeśli wiadomość ma analizę.
- Pełna zgodność z poprzednimi etapami:
  - **ETAP 1** – system stanów, logger, sidepanel,
  - **ETAP 2/2*** – Auto-FULL-message + Manual-Thread,
  - **ETAP 3** – cache (Thread + Message), Thread Intelligence.

---

## 1. Background – rozszerzenie `messageCache`

### Plik: `chrome_extension/background.js`

### 1.1. Struktura `messageCache` (ETAP 4)

```javascript
let messageCache = {};  
// { 
//   messageId: { 
//     threadId, 
//     processed, 
//     hasAnalysis,      // <- ETAP 3/4
//     lastFetchedAt,
//     analysisData,     // <- ETAP 4: JSON z LLM
//     analyzedAt        // <- ETAP 4: timestamp analizy
//   } 
// }
```

**Nowe pola:**
- `analysisData: object | null` – pełny JSON zwrócony przez `analyze-message` (firmy, kontakty),
- `analyzedAt: number | null` – `Date.now()` w momencie zakończenia analizy.

---

### 1.2. Funkcja `updateMessageCache` (zaktualizowana)

```javascript
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
```

**Zachowanie:**
- Przy aktualizacji wiadomości **nie nadpisuje** istniejących danych analizy (`analysisData`, `analyzedAt`).
- Dzięki temu `hasAnalysis` i `analysisData` przetrwają nawet po ponownym otwarciu wiadomości.

---

### 1.3. Nowy listener: `analyze-message`

```javascript
// ETAP 4: Analyze-message (LLM)
if (message.type === 'analyze-message') {
  const msgId = message.messageId;
  const tId = message.threadId;
  
  console.log('[Background] 🤖 Analyze-message START:', msgId);
  
  const analyzeStart = performance.now();
  callGAS('analyze-message', {
    messageId: msgId,
    threadId: tId
  }).then(result => {
    const analyzeTime = performance.now() - analyzeStart;
    
    if (result.success) {
      console.log(`[Background] ✅ Analyze-message OK: ${analyzeTime.toFixed(0)}ms`);
      
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
      
      // Log performance
      if (backgroundLogger) {
        backgroundLogger.info('🤖 LLM Analysis Complete', {
          analyzeTime: `${analyzeTime.toFixed(0)}ms`,
          messageId: msgId,
          threadId: tId,
          companiesCount: result.analysis?.companies?.length || 0,
          contactsCount: result.analysis?.contacts?.length || 0
        });
      }
      
      // Wyślij do sidepanel
      chrome.runtime.sendMessage({
        type: 'analysis-ready',
        messageId: msgId,
        data: result.analysis
      }).catch(() => {});
    } else {
      console.error('[Background] Analyze-message failed:', result.error);
      chrome.runtime.sendMessage({
        type: 'analysis-error',
        messageId: msgId,
        error: result.error
      }).catch(() => {});
    }
  });
  
  sendResponse({ success: true });
}
```

**Kluczowe kroki:**
1. Wywołanie `callGAS('analyze-message', { messageId, threadId })`,
2. Aktualizacja `messageCache[msgId]` po sukcesie:
   - `hasAnalysis = true`,
   - `analysisData = result.analysis`,
   - `analyzedAt = Date.now()`.
3. Zapis cache do `chrome.storage.local`.
4. Wysłanie `analysis-ready` do sidepanel (lub `analysis-error` w przypadku błędu).

---

### 1.4. Nowy listener: `get-message-cache`

```javascript
// ETAP 4: Pobierz cache dla konkretnej wiadomości (do sprawdzenia hasAnalysis)
if (message.type === 'get-message-cache') {
  const msgId = message.messageId;
  const cache = messageCache[msgId] || null;
  sendResponse({ success: true, cache: cache });
}
```

**Cel:**
- Sidepanel może **zapytać** background o cache dla danego `messageId`.
- Używane w `updateUI()` do:
  - wyświetlenia ✓ przy `messageId` jeśli `hasAnalysis === true`,
  - ustawienia tekstu przycisku ("Zobacz analizę" vs "Analizuj LLM").

---

## 2. GAS – nowy endpoint `analyzeMessage`

### Plik: `G_APP_backend/Kod.js`

### 2.1. Funkcja `analyzeMessage(messageId)`

```javascript
/**
 * ETAP 4.0: Endpoint do analizy wiadomości przez LLM (Mock JSON)
 * 
 * W ETAP 4.0 zwraca MOCK JSON w finalnym formacie.
 * W ETAP 4.1 zostanie podpięty prawdziwy Cloud Run + Gemini 2.5 Pro.
 * 
 * @param {string} messageId - ID wiadomości Gmail
 * @returns {Object} - { success: true, analysis: {...} }
 */
function analyzeMessage(messageId) {
  try {
    if (!messageId || messageId.trim() === '') {
      return {
        success: false,
        error: 'messageId jest pusty'
      };
    }
    
    Logger.log('[GAS] 🤖 analyzeMessage START (MOCK): ' + messageId);
    
    // Pobierz pełną wiadomość (format FULL)
    // W ETAP 4.0 to tylko dla sprawdzenia czy messageId jest poprawny
    const message = GmailApp.getMessageById(messageId);
    if (!message) {
      return {
        success: false,
        error: 'Nie znaleziono wiadomości o ID: ' + messageId
      };
    }
    
    // W ETAP 4.1 tutaj będzie wywołanie Cloud Run + Gemini
    // Na razie zwracamy MOCK JSON w finalnym formacie
    
    const mockAnalysis = {
      companies: [
        {
          company_name: "Example Medical Sp. z o.o.",
          company_friendly_name: "ExMed",
          website: "exmed.pl",
          phone: "+48 22 123 45 67",
          email: "kontakt@exmed.pl",
          nip: "1234567890"
        },
        {
          company_name: "HealthTech Solutions",
          company_friendly_name: "HealthTech",
          website: "healthtech.com",
          phone: null,
          email: "info@healthtech.com",
          nip: null
        }
      ],
      contacts: [
        {
          first_name: "Jan",
          last_name: "Kowalski",
          role: "Dyrektor ds. Sprzedaży",
          phone: "+48 22 123 45 68",
          mobile: "+48 600 123 456",
          email: "j.kowalski@exmed.pl",
          company_name: "Example Medical Sp. z o.o.",
          salutation: "Pan"
        },
        {
          first_name: "Anna",
          last_name: "Nowak",
          role: "Project Manager",
          phone: null,
          mobile: "+48 601 234 567",
          email: "a.nowak@healthtech.com",
          company_name: "HealthTech Solutions",
          salutation: "Pani"
        }
      ]
    };
    
    Logger.log('[GAS] ✅ analyzeMessage COMPLETE (MOCK): ' + messageId);
    Logger.log('[GAS] Mock: ' + mockAnalysis.companies.length + ' companies, ' + mockAnalysis.contacts.length + ' contacts');
    
    return {
      success: true,
      messageId: messageId,
      analysis: mockAnalysis,
      isMock: true, // Flaga informująca że to mock (usunąć w ETAP 4.1)
      analyzedAt: new Date().toISOString()
    };
    
  } catch (error) {
    Logger.log('[GAS] ❌ Błąd analyzeMessage: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}
```

**Format JSON (FINALNY – zgodny z wymaganiami ETAP 4):**

```json
{
  "companies": [
    {
      "company_name": "...",
      "company_friendly_name": "...",
      "website": "...",
      "phone": "...",
      "email": "...",
      "nip": "..."
    }
  ],
  "contacts": [
    {
      "first_name": "...",
      "last_name": "...",
      "role": "...",
      "phone": "...",
      "mobile": "...",
      "email": "...",
      "company_name": "...",
      "salutation": "Pan" | "Pani" | null
    }
  ]
}
```

**ETAP 4.1 (przyszłość):**
- Podmiana mocka na prawdziwe wywołanie:
  - `Cloud Run` (Node.js/Python),
  - `Gemini 2.5 Pro` API,
  - `Firestore` do zapisu wyników (zamiast `chrome.storage.local`).

---

### 2.2. Routing w `doPost`

```javascript
// ========== ETAP 2*: Gmail API Routing ==========
if (data.action) {
  let result;
  
  // ETAP 2*: fetch-message-simple teraz używa pełnej wiadomości
  if (data.action === 'fetch-message-simple' || data.action === 'fetch-message-full') {
    result = fetchMessageFull(data.messageId, data.threadId);
  } else if (data.action === 'get-thread-metadata') {
    // Thread Intelligence: szybkie sprawdzenie messageCount (20-50ms)
    result = getThreadMetadata(data.messageId);
  } else if (data.action === 'fetch-thread-full') {
    result = fetchThreadFull(data.threadId, data.messageId);
  } else if (data.action === 'analyze-message') {
    // ETAP 4: Analiza LLM (Mock w 4.0, prawdziwy Cloud Run w 4.1)
    result = analyzeMessage(data.messageId);
  } else {
    result = {
      success: false,
      error: 'Nieznana akcja: ' + data.action
    };
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
```

---

## 3. Sidepanel – UI dla analizy LLM

### Plik: `chrome_extension/sidepanel.html`

### 3.1. Nowy przycisk "Analizuj LLM"

```html
<!-- ETAP 4: Przycisk do analizy LLM -->
<div class="info-row">
  <button id="analyzeLLMBtn" class="fetch-btn" style="display: none; background-color: #7c3aed;">
    🤖 Analizuj LLM
  </button>
</div>
```

**Widoczność:**
- Pokazywany **tylko** gdy:
  - `processed === true` (wiadomość była już pobrana),
  - `hasAnalysis === false` (analiza jeszcze nie istnieje).
- Po analizie zmienia tekst na: **"🤖 Zobacz analizę LLM"**.

---

### 3.2. Nowa sekcja "Analiza LLM"

```html
<!-- ETAP 4: Sekcja analizy LLM -->
<div id="analysisSection" style="display: none;">
  <hr style="margin: 20px 0; border: none; border-top: 1px solid #e0e0e0;">
  <details>
    <summary style="font-size: 14px; font-weight: 600; color: #7c3aed; cursor: pointer; margin-bottom: 10px;">
      🤖 Analiza LLM
    </summary>
    <div id="analysisData" style="font-size: 12px; background: #faf5ff; padding: 10px; border-radius: 4px; max-height: 400px; overflow-y: auto; white-space: pre-wrap; font-family: 'Courier New', monospace; border-left: 3px solid #7c3aed;"></div>
  </details>
</div>
```

**Cechy:**
- `<details>` – domyślnie zwinięte, można rozwinąć,
- Tło: `#faf5ff` (jasny fiolet),
- Border: `#7c3aed` (fioletowy akcent),
- JSON wyświetlany w `pre-wrap` (czytelny format).

---

### 3.3. Ikonka ✓ przy `messageId`

```css
/* ETAP 4: Styl dla checkmark przy messageId */
.has-analysis-check {
  color: #10b981;
  font-weight: bold;
  margin-left: 5px;
}
```

```javascript
// W updateUI(), jeśli hasAnalysis === true:
messageIdElement.innerHTML = `${state.messageId} <span class="has-analysis-check">✓</span>`;
```

**Cel:**
- Wizualny wskaźnik, że wiadomość ma już gotową analizę LLM.

---

## 4. Sidepanel – logika analizy

### Plik: `chrome_extension/sidepanel.js`

### 4.1. State machine dla LLM

```javascript
// ETAP 4: LLM Analysis state
let llmState = {
  hasAnalysis: false,
  analysisData: null,
  isAnalyzing: false
};
```

---

### 4.2. Reset analizy (przy zmianie kontekstu)

```javascript
// ETAP 4: Funkcja czyszcząca sekcję analizy LLM
function resetAnalysisData() {
  if (analysisData) {
    analysisData.textContent = '';
  }
  if (analysisSection) {
    analysisSection.style.display = 'none';
  }
  llmState.hasAnalysis = false;
  llmState.analysisData = null;
  llmState.isAnalyzing = false;
  console.log('[Sidepanel] Wyczyszczono sekcję analizy LLM');
}
```

Wywoływana w `updateUI()` przy `shouldReset === true`.

---

### 4.3. Listener przycisku "Analizuj LLM"

```javascript
// ETAP 4: Obsługa przycisku "Analizuj LLM"
if (analyzeLLMBtn) {
  analyzeLLMBtn.addEventListener('click', () => {
    console.log('[Sidepanel] 🤖 CLICK na przycisk Analizuj LLM');
    
    if (!currentState || !currentState.messageId) {
      console.log('[Sidepanel] ⚠️ Brak messageId do analizy');
      return;
    }

    // Jeśli analiza już istnieje, wyświetl ją
    if (llmState.hasAnalysis && llmState.analysisData) {
      console.log('[Sidepanel] 💾 Analiza już istnieje - wyświetlam z cache');
      displayAnalysisData(llmState.analysisData);
      return;
    }

    // Uruchom analizę
    console.log('[Sidepanel] 🚀 Uruchamiam analizę LLM:', currentState.messageId);
    llmState.isAnalyzing = true;
    
    chrome.runtime.sendMessage({
      type: 'analyze-message',
      messageId: currentState.messageId,
      threadId: currentState.threadId
    }).then(response => {
      console.log('[Sidepanel] ✅ Odpowiedź z background (analyze-message):', response);
    }).catch(err => {
      console.log('[Sidepanel] ❌ Błąd wysyłania analyze-message:', err.message);
      llmState.isAnalyzing = false;
    });

    // Wizualna informacja
    analysisSection.style.display = 'block';
    analysisData.textContent = '⏳ Analizuję wiadomość za pomocą LLM...';
  });
}
```

**Zachowanie:**
1. Jeśli `hasAnalysis === true` → wyświetl z pamięci (bez ponownej analizy).
2. W przeciwnym razie → wyślij `analyze-message` do background.
3. Pokaż loader: "⏳ Analizuję...".

---

### 4.4. Wyświetlanie wyniku analizy

```javascript
// ETAP 4: Funkcja wyświetlająca analizę LLM
function displayAnalysisData(analysis) {
  const startTime = performance.now();
  
  analysisSection.style.display = 'block';
  const jsonString = JSON.stringify(analysis, null, 2);
  analysisData.textContent = jsonString;
  
  const renderTime = performance.now() - startTime;
  const dataSize = new Blob([jsonString]).size;
  
  console.log(`[Sidepanel] 🤖 Wyświetlono analizę LLM: ${renderTime.toFixed(1)}ms, ${dataSize} bytes`);
  
  if (sidepanelLogger) {
    sidepanelLogger.info('🤖 Performance LLM Analysis Display', {
      renderTime: `${renderTime.toFixed(1)}ms`,
      dataSize: `${dataSize} bytes`,
      companiesCount: analysis.companies?.length || 0,
      contactsCount: analysis.contacts?.length || 0
    });
  }
}
```

**Metryki:**
- `renderTime` – czas renderowania JSON w UI,
- `dataSize` – rozmiar JSON w bajtach,
- `companiesCount`, `contactsCount` – liczba znalezionych firm/kontaktów.

---

### 4.5. Message listeners

```javascript
// ETAP 4: Analiza LLM gotowa
if (message.type === 'analysis-ready') {
  console.log('[Sidepanel] 🤖 Otrzymano analysis-ready:', message.data);
  llmState.hasAnalysis = true;
  llmState.analysisData = message.data;
  llmState.isAnalyzing = false;
  
  // Zaktualizuj przycisk - pokaż że analiza jest dostępna
  if (analyzeLLMBtn) {
    analyzeLLMBtn.textContent = '🤖 Zobacz analizę LLM';
  }
  
  // Dodaj ✓ przy messageId
  if (currentState?.messageId && messageIdElement) {
    messageIdElement.innerHTML = `${currentState.messageId} <span class="has-analysis-check">✓</span>`;
  }
  
  displayAnalysisData(message.data);
}

// ETAP 4: Błąd analizy LLM
if (message.type === 'analysis-error') {
  console.log('[Sidepanel] ❌ Błąd analizy LLM:', message.error);
  llmState.isAnalyzing = false;
  
  analysisSection.style.display = 'block';
  analysisData.textContent = `❌ Błąd analizy LLM:\n\n${message.error}`;
  
  if (analyzeLLMBtn) {
    analyzeLLMBtn.textContent = '🤖 Analizuj LLM (ponów)';
  }
}
```

---

## 5. Przepływ końca do końca (ETAP 4.0)

### Scenariusz: użytkownik otwiera mail, klika "Analizuj LLM"

1. **Gmail**: użytkownik otwiera wiadomość `messageId = "ABC123"`.
2. **Content Script** wykrywa stan `mail_opened`, wysyła do **Background**.
3. **Background**:
   - AUTO-FETCH: pobiera pełną wiadomość (`fetch-message-full`),
   - zapisuje `messageCache["ABC123"] = { processed: true, hasAnalysis: false, ... }`,
   - wysyła `auto-mail-data` do **Sidepanel**.
4. **Sidepanel**:
   - wyświetla treść wiadomości,
   - zapytuje Background o cache (`get-message-cache`),
   - ponieważ `hasAnalysis === false`, pokazuje przycisk **"🤖 Analizuj LLM"**.
5. **Użytkownik** klika przycisk.
6. **Sidepanel** wysyła `analyze-message` do **Background**.
7. **Background** wywołuje GAS `analyze-message`.
8. **GAS**:
   - pobiera pełną wiadomość (dla walidacji),
   - zwraca **mock JSON** (firmy + kontakty),
   - `{ success: true, analysis: {...}, isMock: true }`.
9. **Background**:
   - aktualizuje `messageCache["ABC123"].hasAnalysis = true`,
   - zapisuje `analysisData` i `analyzedAt`,
   - wywołuje `saveCacheToStorage()`,
   - wysyła `analysis-ready` do **Sidepanel**.
10. **Sidepanel**:
    - wyświetla JSON w sekcji "🤖 Analiza LLM",
    - dodaje ✓ przy `messageId`,
    - zmienia tekst przycisku na **"🤖 Zobacz analizę LLM"**.

---

## 6. Co się NIE zmienia (zgodność wsteczna)

- **ETAP 1** (system stanów, logger) – bez zmian.
- **ETAP 2/2*** (Auto-FULL-message, Manual-Thread) – bez zmian.
- **ETAP 3** (cache, Thread Intelligence) – rozszerzony o pola LLM, ale logika niezmieniona.

**Cache thread/message:**
- `threadCache` – niezmieniony,
- `messageCache` – dodane pola `analysisData`, `analyzedAt`, ale wszystkie funkcje `updateMessageCache()` zachowują istniejące wartości.

---

## 7. Uprawnienia

### Plik: `chrome_extension/manifest.json`

```json
{
  "permissions": [
    "sidePanel",
    "storage"  // <- ETAP 3/4: dla chrome.storage.local (cache)
  ],
  "host_permissions": [
    "https://mail.google.com/*",
    "https://script.google.com/*",
    "https://www.googletagmanager.com/*"
  ]
}
```

**Nowe od ETAP 3:**
- `"storage"` – wymagane dla `chrome.storage.local` (cache).

**GCP / Gmail API:**
- Konfiguracja z **ETAP 1/2** jest wystarczająca.
- OAuth Scopes:
  - `https://www.googleapis.com/auth/gmail.readonly`,
  - `https://www.googleapis.com/auth/drive.file`.

---

## 8. ETAP 4.1 – co będzie dalej (zapowiedź)

- **Cloud Run** (Node.js/Python):
  - prawdziwe wywołanie Gemini 2.5 Pro API,
  - bezpieczne trzymanie klucza API (Secret Manager),
  - retry logic, rate limiting.
- **Firestore**:
  - zapis `analysis` per `messageId`,
  - synchronizacja z `chrome.storage.local`.
- **Automatyzacja**:
  - opcja auto-analizy po AUTO-FETCH (jeśli `processed && !hasAnalysis`).
- **Batch processing**:
  - przetwarzanie wielu wiadomości na raz (np. codziennie o 2:00).

---

## 9. Podsumowanie ETAP 4.0

| Element | Status ETAP 4.0 | Dalej (ETAP 4.1) |
|---------|----------------|------------------|
| **Endpoint GAS** | ✅ `analyzeMessage(messageId)` – mock JSON | Podmiana na Cloud Run + Gemini |
| **Cache** | ✅ `analysisData`, `analyzedAt` w `messageCache` | Synchronizacja z Firestore |
| **UI** | ✅ Przycisk + sekcja + ikonka ✓ | Automatyzacja, batch |
| **Format JSON** | ✅ Finalny (companies, contacts) | Bez zmian |
| **Performance** | ✅ Timery, logi (jak ETAP 2/3) | Cloud Run metrics |

---

## 10. Testowanie ETAP 4.0

### Krok 1: Deploy GAS
- Otwórz `G_APP_backend/Kod.js` w Apps Script.
- Kliknij **Deploy** → **New Deployment** → Web App.
- Skopiuj URL do `chrome_extension/background.js` (`GAS_WEB_APP_URL_FOR_FETCH`).

### Krok 2: Załaduj extension
- Otwórz Chrome → `chrome://extensions/`.
- Włącz "Developer mode".
- Kliknij "Load unpacked" → wybierz folder `chrome_extension/`.

### Krok 3: Testuj
1. Otwórz Gmail (`https://mail.google.com`).
2. Otwórz dowolną wiadomość.
3. Otwórz sidepanel (kliknij ikonę extension).
4. Sprawdź czy:
   - AUTO-FETCH pobiera pełną wiadomość,
   - Przycisk "🤖 Analizuj LLM" jest widoczny (jeśli `processed && !hasAnalysis`).
5. Kliknij "🤖 Analizuj LLM".
6. Sprawdź w konsoli sidepanelu:
   - `[Sidepanel] 🤖 CLICK na przycisk Analizuj LLM`,
   - `[Background] 🤖 Analyze-message START`,
   - `[Background] ✅ Analyze-message OK: Xms`.
7. Sprawdź w UI:
   - Sekcja "🤖 Analiza LLM" się rozwija,
   - JSON mocka (2 firmy, 2 kontakty) jest wyświetlony,
   - Ikonka ✓ pojawia się przy `messageId`,
   - Przycisk zmienia tekst na "🤖 Zobacz analizę LLM".
8. Zamknij mail i otwórz ponownie:
   - ✓ nadal jest widoczna,
   - Przycisk od razu pokazuje "Zobacz analizę".

---

## 11. Przykładowy log z ETAP 4.0

```
[Background] 🤖 Analyze-message START: 19ab256bf212d825
[Background] 🚀 callGAS: analyze-message
[GAS] 🤖 analyzeMessage START (MOCK): 19ab256bf212d825
[GAS] ✅ analyzeMessage COMPLETE (MOCK): 19ab256bf212d825
[GAS] Mock: 2 companies, 2 contacts
[Background] ✅ Analyze-message OK: 450ms
[Background] 🤖 LLM Analysis Complete: 450ms, 2 companies, 2 contacts
[Sidepanel] 🤖 Otrzymano analysis-ready
[Sidepanel] 🤖 Wyświetlono analizę LLM: 2.3ms, 1024 bytes
```

---

## 12. Kontakt / Feedback

- **ETAP 1–3**: System stanów, Auto-FULL, Thread Intelligence, Cache – **stabilne**.
- **ETAP 4.0**: Mock LLM – **gotowe do testów**.
- **ETAP 4.1**: Cloud Run + Gemini 2.5 Pro – **✅ ZAIMPLEMENTOWANE**.

---

# ETAP 4.1 – Cloud Run + Gemini 2.5 Pro + Firestore (PRODUKCJA)

## Przegląd ETAP 4.1

ETAP 4.1 rozszerza ETAP 4.0 o **prawdziwą integrację z Gemini 2.5 Pro** przez Cloud Run.

**Co się zmieniło:**

| Element | ETAP 4.0 (Mock) | ETAP 4.1 (Produkcja) |
|---------|----------------|----------------------|
| **Backend** | Mock JSON w GAS | Cloud Run (Node.js 20) + Vertex AI |
| **Model AI** | Brak | Gemini 2.5 Pro / 2.0 Flash |
| **Storage** | `chrome.storage.local` | Firestore + `chrome.storage.local` |
| **Prompt** | Brak | Pełny enterprise prompt (PROMPT.txt) |
| **Security** | Brak | Secret Manager (GCP_API_GEMINI) |
| **Monitoring** | Console logs | Cloud Run Metrics + Firestore Usage |
| **Deployment** | Brak | Cloud Shell + gcloud CLI |

---

## 1. Architektura ETAP 4.1

```
┌──────────────┐
│  Gmail Web   │
└──────┬───────┘
       │ (1) mail_opened
       ▼
┌──────────────┐
│ Content.js   │──(2) gmail-state-changed──┐
└──────────────┘                           │
                                           ▼
                                  ┌────────────────┐
                                  │ Background.js  │
                                  │  - AUTO-FETCH  │
                                  │  - Cache       │
                                  └────┬───────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
              │ (3) fetch-message-full │ (5) analyze-message   │
              ▼                        ▼                        │
       ┌──────────────┐         ┌──────────────┐               │
       │ GAS WebApp   │         │ GAS WebApp   │               │
       │ (Kod.js)     │         │ (Kod.js)     │               │
       └──────┬───────┘         └──────┬───────┘               │
              │                        │                        │
              │ (4) Return JSON        │ (6) HTTP POST          │
              │                        ▼                        │
              │               ┌─────────────────────┐           │
              │               │  Cloud Run          │           │
              │               │  (index.js)         │           │
              │               │  ┌───────────────┐  │           │
              │               │  │ Gemini 2.5 Pro│  │           │
              │               │  │ (Vertex AI)   │  │           │
              │               │  └───────────────┘  │           │
              │               │         ▼            │           │
              │               │  ┌───────────────┐  │           │
              │               │  │  Firestore    │  │           │
              │               │  │  (Analysis)   │  │           │
              │               │  └───────────────┘  │           │
              │               └──────┬──────────────┘           │
              │                      │ (7) Return analysis      │
              │                      ▼                          │
              └──────────────────────┼──────────────────────────┘
                                     │
                                     ▼
                              ┌──────────────┐
                              │ Sidepanel.js │
                              │ - Display    │
                              │ - Cache ✓    │
                              └──────────────┘
```

---

## 2. Cloud Run – Backend (Node.js 20)

### Plik: `cloudrun-llm-backend/index.js`

**Kluczowe elementy:**

### 2.1. Konfiguracja

```javascript
const PROJECT_ID = "gmail-crm-extension-479113";
const LOCATION = "us-central1"; // region Vertex AI, w którym jest dostępny model 2.5 Pro
const GEMINI_MODEL = "gemini-2.5-pro"; // Enterprise-grade model używany w prod
```

> **Uwaga:** Usługa Cloud Run działa w regionie `europe-central2`, ale sam Vertex AI
> pozostaje w `us-central1`, ponieważ tam dostępny jest Gemini 2.5 Pro. To ustawienie
> nie ma wpływu na działanie – Cloud Run komunikuje się z Vertex AI przez prywatne API.

---

### 2.2. Autoryzacja (ADC + IAM)

- Vertex AI SDK korzysta z **Application Default Credentials (ADC)** – Cloud Run
  automatycznie podpisuje zapytania po stronie serwera, więc **nie potrzebujemy** już
  pobierać klucza API z Secret Managera.
- Wystarczy, że konto serwisowe Cloud Run (`183771205172-compute@developer.gserviceaccount.com`)
  ma rolę **`roles/aiplatform.user`** (oraz dotychczasowe role do Firestore i Secret Managera,
  jeśli w przyszłości wrócimy do trzymania kluczy w tajemnicy).
- Sekret `GCP_API_GEMINI` zostaje w projekcie (można go wykorzystać np. z AppScript),
  ale backend Cloud Run nie odczytuje go już w czasie działania.

---

### 2.3. Vertex AI Initialization

```javascript
async function initGemini() {
  const vertex = new VertexAI({
    project: PROJECT_ID,
    location: LOCATION,
  });

  model = vertex.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: 0.1, // Low temp for consistent JSON
      maxOutputTokens: 8192,
      topP: 0.95,
    },
  });

  console.log("✅ Gemini initialized successfully (ADC)");
}
```

**Parametry:**
- `temperature: 0.1` – niska temperatura dla stabilnego JSON (nie kreatywne odpowiedzi)
- `maxOutputTokens: 8192` – maksymalnie 8K tokenów na wyjściu (wystarczy dla firm/kontaktów)

---

### 2.4. Endpoint `/analyze`

```javascript
app.post("/analyze", async (req, res) => {
  const { messageId, threadId, fullRawEmail } = req.body;
  
  // Validation
  if (!messageId || !fullRawEmail) {
    return res.status(400).json({ error: "Missing fields" });
  }

  // Build prompt
  const prompt = buildPrompt(fullRawEmail);
  
  // Call Gemini
  const result = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  
  // Parse JSON
  const responseText = result.response.candidates[0].content.parts[0].text.trim();
  const cleanText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const analysis = JSON.parse(cleanText);
  
  // Save to Firestore
  await db.collection("messages").doc(messageId).set({
    threadId,
    analysis,
    analyzedAt: Date.now(),
    geminiModel: GEMINI_MODEL,
  }, { merge: true });
  
  // Return
  res.json({ success: true, analysis, metadata: {...} });
});
```

**Flow:**
1. Validation – sprawdź czy `messageId` i `fullRawEmail` są podane
2. Build prompt – wstaw treść emaila do szablonu promptu
3. Call Gemini – wywołaj Vertex AI
4. Parse JSON – usuń markdown (```json) i sparsuj
5. Save to Firestore – zapisz wynik
6. Return – zwróć analysis do GAS

---

### 2.5. Health Check

```javascript
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    service: "gmail-crm-llm-backend",
    model: GEMINI_MODEL,
    project: PROJECT_ID 
  });
});
```

**Użycie:** sprawdzenie czy Cloud Run działa (`curl https://YOUR-URL/health`)

---

## 3. GAS – Integracja z Cloud Run

### Plik: `G_APP_backend/Kod.js`

**Zmieniona funkcja `analyzeMessage()`:**

```javascript
const CLOUD_RUN_URL = 'https://YOUR-CLOUD-RUN-URL/analyze';

function analyzeMessage(messageId, threadId) {
  // Pobierz pełną wiadomość
  const message = GmailApp.getMessageById(messageId);
  
  // Zbuduj treść emaila (Subject + From + Body)
  const emailContent = 
    'Subject: ' + message.getSubject() + '\n' +
    'From: ' + message.getFrom() + '\n' +
    'Date: ' + message.getDate() + '\n' +
    'To: ' + message.getTo() + '\n\n' +
    message.getPlainBody();
  
  // Payload dla Cloud Run
  const payload = {
    messageId: messageId,
    threadId: threadId || message.getThread().getId(),
    fullRawEmail: emailContent
  };
  
  // Wywołaj Cloud Run
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  
  const response = UrlFetchApp.fetch(CLOUD_RUN_URL, options);
  const result = JSON.parse(response.getContentText());
  
  return result;
}
```

**Co się dzieje:**
1. GAS pobiera pełną wiadomość z Gmail API
2. Formatuje do czytelnego tekstu (Subject, From, Body)
3. Wysyła HTTP POST do Cloud Run
4. Cloud Run analizuje przez Gemini
5. Cloud Run zapisuje do Firestore
6. Cloud Run zwraca JSON
7. GAS przekazuje JSON do Extension

---

## 4. Firestore Schema

### Kolekcja: `messages`

**Document ID:** `messageId` (np. `19ab256bf212d825`)

**Struktura:**

```json
{
  "threadId": "19ab256bf212d825",
  "messageId": "19ab256bf212d825",
  "analysis": {
    "companies": [
      {
        "company_name": "Example Medical Sp. z o.o.",
        "company_friendly_name": "ExMed",
        "website": "exmed.pl",
        "phone": "+48 22 123 45 67",
        "email": "kontakt@exmed.pl",
        "nip": "1234567890"
      }
    ],
    "contacts": [
      {
        "first_name": "Jan",
        "last_name": "Kowalski",
        "role": "Dyrektor ds. Sprzedaży",
        "phone": "+48 22 123 45 68",
        "mobile": "+48 600 123 456",
        "email": "j.kowalski@exmed.pl",
        "company_name": "Example Medical Sp. z o.o.",
        "salutation": "Pan"
      }
    ]
  },
  "analyzedAt": 1732752000000,
  "geminiModel": "gemini-2.0-flash-exp",
  "processingTimeMs": 2345
}
```

**Szczegóły:** Zobacz `cloudrun-llm-backend/firestore-schema.md`

---

## 5. Deployment (Cloud Run)

### Kroki (szczegóły w `cloudrun-llm-backend/DEPLOYMENT.md`):

1. **Włącz API:**
   - Cloud Run API
   - Cloud Build API
   - Firestore API
   - Vertex AI API

2. **Skonfiguruj Firestore:**
   ```bash
   gcloud firestore databases create --location=europe-west3
   ```

3. **Deploy Cloud Run:**
   ```bash
   cd cloudrun-llm-backend
   gcloud run deploy gmail-crm-llm-backend \
     --source . \
     --region us-central1 \
     --allow-unauthenticated \
     --memory 1Gi \
     --timeout 60s
   ```

4. **Nadaj uprawnienia Service Account:**
   - Secret Manager Secret Accessor (dla `GCP_API_GEMINI`)
   - Firestore User (dla zapisu/odczytu)
   - Vertex AI User (dla Gemini)

5. **Zaktualizuj GAS:**
   - Wklej URL Cloud Run do `CLOUD_RUN_URL`
   - Deploy GAS

---

## 6. Koszty

### Szacunkowe koszty miesięczne (1000 analiz):

| Usługa | Koszt | Free Tier |
|--------|-------|-----------|
| **Cloud Run** | $0.10 | 2M vCPU-seconds |
| **Firestore** | $0.01 | 1 GB storage |
| **Gemini 2.5 Pro** | $6.25 | Brak |
| **RAZEM** | **~$6.36** | Tylko Cloud Run + Firestore w Free Tier |

**Gemini 2.5 Pro (używany w projekcie):**
- Input: $1.25 / 1M tokenów  
- Output: $5.00 / 1M tokenów
- 1000 analiz × ~2000 tokenów (1000 input + 1000 output)
- Input: 1M × $1.25 = $1.25
- Output: 1M × $5.00 = $5.00
- **Razem: ~$6.25/miesiąc** dla 1000 analiz

**Uwaga:** Gemini 2.5 Pro to model **Enterprise-grade**, najwyższa jakość ekstrakcji danych.

---

## 7. Monitoring

### Cloud Run Metrics:
- https://console.cloud.google.com/run/detail/us-central1/gmail-crm-llm-backend/metrics
- **Request latency:** Średni czas odpowiedzi (powinno być <5s)
- **Request count:** Ile analiz dziennie
- **Instance count:** Skalowanie (powinno być 0 gdy brak ruchu)

### Firestore Metrics:
- https://console.cloud.google.com/firestore/usage
- **Reads/Writes:** Operacje (Free: 50k/20k dziennie)
- **Storage:** Rozmiar bazy (Free: 1 GB)

### Vertex AI Metrics:
- https://console.cloud.google.com/vertex-ai/generative
- **API calls:** Liczba wywołań Gemini
- **Token usage:** Ile tokenów zużyto (to kosztuje!)

---

## 8. Testowanie ETAP 4.1

### 8.1. Test Cloud Run (curl)

```bash
curl -X POST https://YOUR-CLOUD-RUN-URL/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "test-123",
    "threadId": "test-thread",
    "fullRawEmail": "Subject: Test\nFrom: test@example.com\n\nDzień dobry,\nJan Kowalski\nExample Medical\ntel: +48 600 123 456"
  }'
```

**Oczekiwana odpowiedź:** JSON z `companies` i `contacts`

### 8.2. Test end-to-end (Extension)

1. Otwórz Gmail → otwórz mail
2. Kliknij "🤖 Analizuj LLM"
3. Sprawdź logi Cloud Run:
   ```
   🤖 Analyzing messageId: 19ab...
   ⏱️ Gemini response time: 2340ms
   ✅ Analysis complete
   ```
4. Sprawdź Firestore:
   - https://console.cloud.google.com/firestore
   - Powinna być kolekcja `messages` z dokumentem `messageId`

---

## 9. Różnice ETAP 4.0 vs 4.1

| Cecha | ETAP 4.0 | ETAP 4.1 |
|-------|----------|----------|
| **Analiza** | Mock (2 firmy, 2 kontakty) | Gemini 2.5 Pro |
| **Backend** | GAS tylko | GAS + Cloud Run |
| **Storage** | chrome.storage.local | Firestore + chrome.storage.local |
| **Prompt** | Brak | Pełny enterprise prompt |
| **Koszty** | $0 | ~$6.25/1000 analiz (Gemini 2.5 Pro) |
| **Czas analizy** | <100ms (mock) | 2-8s (Gemini 2.5 Pro) |
| **Jakość** | Stała | Zależy od treści maila |

---

## 10. Pliki ETAP 4.1

```
ZCRM_CCE2/
├── cloudrun-llm-backend/          ← NOWY FOLDER
│   ├── package.json               ← Dependencies
│   ├── index.js                   ← Cloud Run server
│   ├── PROMPT.txt                 ← Enterprise prompt
│   ├── Dockerfile                 ← Optional (Cloud Run auto-builds)
│   ├── .gcloudignore              ← Ignore list
│   ├── firestore-schema.md        ← Firestore schema
│   └── DEPLOYMENT.md              ← Deployment instructions
├── G_APP_backend/
│   └── Kod.js                     ← Zaktualizowany (Cloud Run call)
├── chrome_extension/
│   ├── background.js              ← Bez zmian (ETAP 4.0)
│   ├── sidepanel.js               ← Bez zmian (ETAP 4.0)
│   └── ...
└── ETAP4_DOKUMENTACJA.md          ← Ten plik (zaktualizowany)
```

---

## 11. Kolejne kroki (ETAP 5+)

### Możliwe rozszerzenia:

1. **Automatyczna analiza** – po AUTO-FETCH jeśli `!hasAnalysis`
2. **Batch processing** – analiza wielu maili naraz (nocne zadania)
3. **Deduplikacja** – firmy/kontakty w osobnych kolekcjach Firestore
4. **Integracja z Zoho CRM** – automatyczne tworzenie leadów/kontaktów
5. **AI Scoring** – ocena jakości leada (1-10) przez Gemini
6. **Dashboard** – wizualizacja statystyk (ile firm/kontaktów/tydzień)

---

## 12. Troubleshooting ETAP 4.1

### Problem: "Cannot access secret GCP_API_GEMINI"
**Rozwiązanie:** Sprawdź uprawnienia Service Account (Secret Manager Secret Accessor)

### Problem: "Invalid JSON from Gemini"
**Rozwiązanie:** Gemini czasem zwraca markdown. Kod usuwa ` ```json `, ale sprawdź logi Cloud Run.

### Problem: "Timeout 60s"
**Rozwiązanie:** Zwiększ timeout: `gcloud run services update --timeout=120s`

### Problem: "Out of memory"
**Rozwiązanie:** Zwiększ RAM: `gcloud run services update --memory=2Gi`

### Problem: "Extension context invalidated"
**Rozwiązanie:** To normalny komunikat Chrome, gdy przeładowujesz rozszerzenie albo Gmail odświeży kartę, a stary content-script próbuje jeszcze wysłać `chrome.runtime.sendMessage`. Odśwież stronę po przeładowaniu extension – nie wpływa to na logikę ETAP 4.

### Problem: "chrome.storage.local niedostępne - pomijam ładowanie/zapisywanie cache"
**Rozwiązanie:** Service worker w Manifest V3 może zostać usypiany. Background ma celowe zabezpieczenie – loguje ostrzeżenie i po prostu pomija zapis/odczyt cache, żeby nie rzucać błędów. Po kilku sekundach worker startuje ponownie i cache działa dalej.

---

**Koniec dokumentacji ETAP 4.0 + 4.1** 🎉

