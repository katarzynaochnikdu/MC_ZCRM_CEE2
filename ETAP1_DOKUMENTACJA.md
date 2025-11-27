## ETAP 1 – Dokumentacja techniczna kręgosłupa

Ten plik opisuje **dokładnie**, które pliki, funkcje i API odpowiadają za:

- otwieranie/zamykanie sidepanelu po kliknięciu w ikonę rozszerzenia,
- wykrywanie stanów Gmaila,
- komunikację z Google Apps Script,
- tworzenie logów na Google Drive,
- wymagania po stronie Google Cloud / GAS.

---

## 1. Sidepanel – kliknięcie w ikonę → open / close

### 1.1. Deklaracja akcji i sidepanelu – `manifest.json`

- Plik: `chrome_extension/manifest.json`
- Klucz `action` – definiuje ikonę rozszerzenia w pasku Chrome:

```2:19:chrome_extension/manifest.json
  "action": {
    "default_icon": {
      "16": "icon-16.png",
      "32": "icon-32.png",
      "48": "icon-48.png",
      "128": "icon-128.png"
    }
  },
```

- Klucz `side_panel` – przypina plik HTML jako panel boczny:

```37:39:chrome_extension/manifest.json
  "side_panel": {
    "default_path": "sidepanel.html"
  }
```

Chrome dzięki temu wie:
- jaka ikona reprezentuje rozszerzenie,
- jaki panel boczny ma być otwierany/zamykany.

### 1.2. Zachowanie po kliknięciu – `background.js`

- Plik: `chrome_extension/background.js`
- Funkcja: **ustawienie zachowania panelu**:

```52:54:chrome_extension/background.js
// Ustaw zachowanie panelu - otwieranie po kliknięciu w ikonę (toggle obsługuje Chrome)
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[Background] Błąd ustawiania panelu:', error));
```

To wywołanie robi całą magię:
- Chrome **automatycznie** wiąże kliknięcie w ikonę z:
  - otwarciem sidepanelu (jeśli jest zamknięty),
  - zamknięciem sidepanelu (jeśli jest otwarty).
- Nie potrzebujemy własnego `chrome.action.onClicked.addListener`.

> Gdy wcześniej ręcznie nasłuchiwaliśmy `onClicked`, toggle przestawał działać poprawnie – dlatego ten listener został usunięty (zostawiony jako komentarz).

---

## 2. Komunikacja z Google Apps Script (GAS)

### 2.1. Konfiguracja URL Web App – `logger.js`

- Plik: `chrome_extension/logger.js`

```3:6:chrome_extension/logger.js
// KONFIGURACJA: URL do Twojego Google Apps Script Web App
// Skopiuj URL i wklej tutaj:
const GAS_WEB_APP_URL = 'https://script.google.com/a/macros/med-space.pl/s/AKfycbx3O1NZWZZtRMVGXsMf-gi25GHbH-KnsLe9rPj-8HWr682Drs_Mk0z-cJjO0r5Q-AM/exec';
```

Ten URL wskazuje na Web App stworzony w Google Apps Script – to tam lądują logi.

### 2.2. Uprawnienia do domeny GAS – `manifest.json`

- Wymagane, aby rozszerzenie mogło wykonywać `fetch` do `script.google.com`:

```23:26:chrome_extension/manifest.json
  "host_permissions": [
    "https://mail.google.com/*",
    "https://script.google.com/*"
  ],
```

### 2.3. Wysyłanie logów do GAS – metoda `sendLogs()` w `Logger`

- Plik: `chrome_extension/logger.js`
- Klasa: `Logger`
- Metoda: `sendLogs()` – wykrywa środowisko i:
  - w **Service Workerze (background.js)** wywołuje `fetch` bezpośrednio,
  - w **content script/sidepanelu** wysyła logi do backgroundu poprzez `chrome.runtime.sendMessage`.

```57:113:chrome_extension/logger.js
  async sendLogs() {
    if (this.isSending || this.logQueue.length === 0) {
      return;
    }
    
    // Sprawdź czy GAS URL jest skonfigurowany
    if (!GAS_WEB_APP_URL || GAS_WEB_APP_URL === '') {
      // Brak URL - wyczyść kolejkę, logi są w konsoli
      this.logQueue = [];
      return;
    }

    this.isSending = true;
    const logsToSend = [...this.logQueue];
    this.logQueue = [];

    try {
      // Wykrywanie środowiska: Service Worker vs inne
      const isServiceWorker = typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope;

      if (isServiceWorker) {
        // Jesteśmy w background (Service Worker) - wyślij bezpośrednio
        await fetch(GAS_WEB_APP_URL, {
          method: 'POST',
          mode: 'no-cors', 
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: this.source,
            message: logsToSend.map(log => {
              let msg = `[${log.level}] ${log.message}`;
              if (log.additionalData && Object.keys(log.additionalData).length > 0) {
                msg += ' ' + JSON.stringify(log.additionalData);
              }
              return msg;
            }).join('\n'),
            level: 'BATCH',
            timestamp: new Date().toISOString(),
            additionalData: { count: logsToSend.length }
          })
        });
        console.log(`[Logger] Wysłano ${logsToSend.length} logów do Drive (z Background)`);
      } else {
        // Jesteśmy w Content Script lub Sidepanel - wyślij do Background
        chrome.runtime.sendMessage({
          type: 'send-logs-to-gas',
          data: {
            source: this.source,
            logs: logsToSend
          }
        });
      }
    } catch (error) {
      console.error('[Logger] Błąd wysyłania logów:', error);
    } finally {
      this.isSending = false;
    }
  }
```

> `mode: 'no-cors'` jest kluczowe – GAS Web App nie zwraca nagłówków CORS, ale w tym trybie Chrome pozwala wysłać request bez czytania odpowiedzi.

---

## 3. Tworzenie logów – przechwytywanie *wszystkiego*

### 3.1. Przechwycenie `console.*` – `captureConsole()`

- Plik: `chrome_extension/logger.js`
- Metoda: `captureConsole()` – nadpisuje `console.log/warn/error/debug`, zapisując wszystko do kolejki Loggera:

```23:55:chrome_extension/logger.js
  captureConsole() {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalDebug = console.debug;

    const self = this;

    console.log = function(...args) {
      originalLog.apply(console, args);
      // Unikaj pętli nieskończonej (nie loguj logów loggera)
      if (args[0] && typeof args[0] === 'string' && args[0].startsWith('[Logger]')) return;
      self.log(LOG_LEVELS.INFO, args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    };

    console.warn = function(...args) {
      originalWarn.apply(console, args);
      self.log(LOG_LEVELS.WARN, args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    };

    console.error = function(...args) {
      originalError.apply(console, args);
      self.log(LOG_LEVELS.ERROR, args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    };
    
    console.debug = function(...args) {
      originalDebug.apply(console, args);
      self.log(LOG_LEVELS.DEBUG, args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
    };
    
    this.info('Przechwytywanie konsoli włączone');
  }
```

### 3.2. Gdzie `captureConsole()` jest włączane?

- **Background (Service Worker)**:

```10:17:chrome_extension/background.js
let backgroundLogger = null;
if (typeof Logger !== 'undefined') {
  backgroundLogger = new Logger('Background');
  backgroundLogger.captureConsole(); // Przechwytuj wszystko z konsoli
  if (!self.loggers) self.loggers = [];
  self.loggers.push(backgroundLogger);
}
```

- **Content Script (Gmail)**:

```201:208:chrome_extension/content.js
let contentLogger = null;
if (typeof Logger !== 'undefined') {
  contentLogger = new Logger('ContentScript');
  contentLogger.captureConsole(); // Przechwytuj wszystko z konsoli
  if (!window.loggers) window.loggers = [];
  window.loggers.push(contentLogger);
}
```

- **Sidepanel**:

```3:7:chrome_extension/sidepanel.js
const sidepanelLogger = new Logger('Sidepanel');
sidepanelLogger.captureConsole(); // Przechwytuj wszystko z konsoli
if (!window.loggers) window.loggers = [];
window.loggers.push(sidepanelLogger);
```

### 3.3. Kolejkowanie i wysyłanie

- Każde wołanie `log()/info()/warn()/error()` tworzy wpis kolejki:

```116:136:chrome_extension/logger.js
  log(level, message, additionalData = {}) {
    const logEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      additionalData
    };
    this.logQueue.push(logEntry);
    if (level === LOG_LEVELS.ERROR) { this.sendLogs(); }
    else if (this.logQueue.length >= 10) { this.sendLogs(); }
  }
```

- Co 2 sekundy globalny timer odpala `sendLogs()` dla wszystkich loggerów:

```172:181:chrome_extension/logger.js
const globalScope = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);
if (globalScope) {
  setInterval(() => {
    const loggers = globalScope.loggers || (typeof self !== 'undefined' && self.loggers);
    if (loggers) {
      loggers.forEach(logger => logger.sendLogs());
    }
  }, 2000);
}
```

---

## 4. Backend Google Apps Script + GCP

### 4.1. Kod backendu – `G_APP_backend/Kod.js`

#### 4.1.1. Folder na logi

```4:19:G_APP_backend/Kod.js
const LOG_FOLDER_NAME = 'ZCRM_CCE2_Logs';

function getOrCreateLogFolder() {
  const folders = DriveApp.getFoldersByName(LOG_FOLDER_NAME);
  
  if (folders.hasNext()) {
    return folders.next();
  } else {
    const folder = DriveApp.createFolder(LOG_FOLDER_NAME);
    Logger.log('Utworzono folder logów: ' + LOG_FOLDER_NAME);
    return folder;
  }
}
```

#### 4.1.2. Jeden plik logu na dzień

```21:65:G_APP_backend/Kod.js
function saveLogToDrive(logData) {
  try {
    const folder = getOrCreateLogFolder();
    
    const now = new Date();
    const timezone = 'Europe/Warsaw';
    const dateStr = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
    const fileName = `log_${dateStr}.txt`;
    
    const files = folder.getFilesByName(fileName);
    let logFile = null;
    
    if (files.hasNext()) {
      logFile = files.next();
    } else {
      logFile = folder.createFile(fileName, '=== Log ZCRM CCE2 - ' + dateStr + ' ===\n\n');
    }
    
    const timestamp = Utilities.formatDate(now, timezone, 'yyyy-MM-dd HH:mm:ss');
    const logEntry = `[${timestamp}] ${logData.source}: ${logData.message}\n`;
    
    const existingContent = logFile.getBlob().getDataAsString();
    logFile.setContent(existingContent + logEntry);
    
    return { success: true, fileName: logFile.getName(), folderName: LOG_FOLDER_NAME };
  } catch (error) {
    Logger.log('Błąd zapisu logu: ' + error.toString());
    return { success: false, error: error.toString() };
  }
}
```

#### 4.1.3. Endpoint `doPost` – wejście z rozszerzenia

```67:98:G_APP_backend/Kod.js
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    if (!data.source || !data.message) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: 'Brak wymaganych pól: source, message'
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    const result = saveLogToDrive({
      source: data.source,
      message: data.message,
      level: data.level || 'INFO',
      timestamp: data.timestamp || new Date().toISOString(),
      additionalData: data.additionalData || {}
    });
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
```

### 4.2. Wymagania GCP / GAS

1. **Google Drive API** musi być włączone w projekcie GCP powiązanym z Apps Script.
2. Web App musi być wdrożony:
   - „Wykonaj jako”: **Ja (właściciel)**,
   - „Kto ma dostęp”: **Każdy**.
3. Deployment ID (`AKfycbx3...`) używany w:
   - `deploy_gas.ps1` (PowerShell do automatycznego wdrożenia),
   - URL `GAS_WEB_APP_URL` w loggerze.

### 4.3. Skrypt wdrożeniowy – `deploy_gas.ps1`

```1:33:deploy_gas.ps1
$OutputEncoding = [System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function gdeploy {
    Write-Host "🚀 Rozpoczynam wdrażanie Google Apps Script..." -ForegroundColor Cyan
    $backendPath = Join-Path $PSScriptRoot "G_APP_backend"
    Push-Location $backendPath
    try {
        Write-Host "📤 Clasp Push..." -ForegroundColor Yellow
        clasp push
        Write-Host "🏷️  Clasp Version..." -ForegroundColor Yellow
        clasp version "auto"
        Write-Host "🚀 Clasp Deploy..." -ForegroundColor Yellow
        clasp deploy -i "AKfycbx3O1NZWZZtRMVGXsMf-gi25GHbH-KnsLe9rPj-8HWr682Drs_Mk0z-cJjO0r5Q-AM"
        Write-Host "✅ Wdrożenie zakończone sukcesem!" -ForegroundColor Green
    } catch {
        Write-Error "❌ Wystąpił błąd podczas wdrażania: $_"
    } finally {
        Pop-Location
    }
}

gdeploy
```

---

## 5. Wykrywanie stanów Gmaila i aktualizacja sidepanelu

### 5.1. Definicje stanów – `content.js`

```3:8:chrome_extension/content.js
const STAN_LOADING = 'loading';
const STAN_INBOX_LIST = 'inbox_list';
const STAN_MAIL_OPENED = 'mail_opened';
const STAN_MAIL_CHANGED = 'mail_changed';
const STAN_THREAD_VIEW = 'thread_view';
```

### 5.2. Funkcje pomocnicze do wykrywania

- Czy Gmail się ładuje:

```15:37:chrome_extension/content.js
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
```

- Odczyt `threadId` z hash w URL:

```40:45:chrome_extension/content.js
function getThreadIdFromHash() {
  const hash = window.location.hash || '';
  // Gmail używa formatu: #inbox/FMfcgzQcqbVqhJGvhPTCqTmcZpGmwNfm
  const match = hash.match(/\/([a-zA-Z0-9_-]{10,})$/);
  return match ? match[1] : null;
}
```

- Odczyt `messageId` z DOM:

```48:65:chrome_extension/content.js
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
```

- Rozpoznanie widoku wątku:

```68:75:chrome_extension/content.js
function isThreadView() {
  const threadId = getThreadIdFromHash();
  if (!threadId) return false;
  
  // Sprawdź czy są widoczne wątki (wiele maili w jednym wątku)
  const threadMessages = document.querySelectorAll('div[role="main"] div[data-message-id], div[role="main"] div[data-legacy-message-id]');
  return threadMessages.length > 1;
}
```

### 5.3. Główna funkcja stanów – `detectGmailState()`

```78:125:chrome_extension/content.js
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
```

### 5.4. Wysyłanie stanu do backgroundu

```128:146:chrome_extension/content.js
function sendStateToBackground(state) {
  if (!state) return;
  chrome.runtime.sendMessage({ type: 'gmail-state-changed', data: state })
    .catch(err => console.error('[Content Script] Błąd wysyłania stanu:', err));
  console.log('[Content Script] Stan wykryty:', state);
  if (contentLogger) {
    contentLogger.info(`Stan wykryty: ${state.stan}`, {
      messageId: state.messageId,
      threadId: state.threadId
    });
  }
}
```

### 5.5. Reakcja backgroundu

```22:40:chrome_extension/background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'gmail-state-changed') {
    console.log('[Background] Otrzymano zmianę stanu:', message.data);
    backgroundLogger.info('Zmiana stanu Gmaila', message.data);
    currentState = message.data;
    chrome.runtime.sendMessage({ type: 'state-update', data: currentState })
      .catch(() => console.log('[Background] Sidepanel nie jest otwarty'));
    sendResponse({ success: true });
  }
  if (message.type === 'get-current-state') {
    console.log('[Background] Sidepanel pyta o aktualny stan');
    sendResponse(currentState);
  }
  return true;
});
```

### 5.6. Aktualizacja UI w sidepanelu

```31:61:chrome_extension/sidepanel.js
function updateUI(state) {
  if (!state) { ... }
  statusElement.textContent = STAN_NAMES[state.stan] || '❓ Nieznany stan';
  statusElement.className = STAN_COLORS[state.stan] || 'status inactive';
  if (state.messageId) { messageIdElement.innerHTML = `<strong>${state.messageId}</strong>`; }
  else { messageIdElement.innerHTML = '<span class="no-data">Brak</span>'; }
  if (state.threadId) { threadIdElement.innerHTML = state.threadId; }
  else { threadIdElement.innerHTML = '<span class="no-data">-</span>'; }
  console.log('[Sidepanel] Zaktualizowano UI stanem:', state);
}
```

Przy starcie sidepanel:

```71:80:chrome_extension/sidepanel.js
chrome.runtime.sendMessage({ type: 'get-current-state' }, (response) => {
  console.log('[Sidepanel] Pobrano aktualny stan:', response);
  updateUI(response);
});
console.log('[Sidepanel] Zainicjalizowano (ETAP 1 - System stanów)');
sidepanelLogger.info('Sidepanel zainicjalizowano (ETAP 1 - System stanów)');
```

---

Ta dokumentacja opisuje **dokładnie**, które funkcje i pliki odpowiadają za:
- działanie sidepanelu (kliknięcie w ikonę → open/close),
- wykrywanie stanów Gmaila i ich propagację do UI,
- komunikację z Google Apps Script,
- tworzenie i wysyłanie logów na Google Drive,
- wymagania konfiguracyjne po stronie GCP/GAS. 