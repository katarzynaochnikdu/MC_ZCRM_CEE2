// Logger - system logowania do Google Drive przez GAS

// KONFIGURACJA: URL do Twojego Google Apps Script Web App
// Aby uzyskać URL:
// 1. Otwórz https://script.google.com
// 2. Wybierz swój projekt ZCRM_CCE2
// 3. Kliknij "Wdróż" → "Nowe wdrożenie"
// 4. Wybierz typ: "Aplikacja internetowa"
// 5. Ustaw: Wykonaj jako: "Ja", Kto ma dostęp: "Każdy"
// 6. Skopiuj URL i wklej tutaj:
const GAS_WEB_APP_URL = 'https://script.google.com/a/macros/med-space.pl/s/AKfycbx3O1NZWZZtRMVGXsMf-gi25GHbH-KnsLe9rPj-8HWr682Drs_Mk0z-cJjO0r5Q-AM/exec';

// Poziomy logowania
const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR'
};

// Klasa Logger
class Logger {
  constructor(source) {
    this.source = source;
    this.logQueue = [];
    this.isSending = false;
  }

  // Wysyłaj logi w batch (co 2 sekundy lub gdy kolejka > 10)
  async sendLogs() {
    if (this.isSending || this.logQueue.length === 0) {
      return;
    }

    this.isSending = true;
    const logsToSend = [...this.logQueue];
    this.logQueue = [];

    try {
      // Wyślij wszystkie logi w jednym request
      const response = await fetch(GAS_WEB_APP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source: this.source,
          message: logsToSend.map(log => `[${log.level}] ${log.message}`).join('\n'),
          level: 'BATCH',
          timestamp: new Date().toISOString(),
          additionalData: {
            count: logsToSend.length,
            logs: logsToSend
          }
        })
      });

      const result = await response.json();
      if (result.success) {
        console.log(`[Logger] Wysłano ${logsToSend.length} logów do Drive`);
      } else {
        console.error('[Logger] Błąd wysyłania logów:', result.error);
        // Przywróć logi do kolejki przy błędzie
        this.logQueue.unshift(...logsToSend);
      }
    } catch (error) {
      console.error('[Logger] Błąd połączenia z GAS:', error);
      // Przywróć logi do kolejki przy błędzie
      this.logQueue.unshift(...logsToSend);
    } finally {
      this.isSending = false;
    }
  }

  // Dodaj log do kolejki
  log(level, message, additionalData = {}) {
    const logEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      additionalData
    };

    // Dodaj do kolejki
    this.logQueue.push(logEntry);

    // Wyślij natychmiast jeśli ERROR
    if (level === LOG_LEVELS.ERROR) {
      this.sendLogs();
    }
    // Wyślij jeśli kolejka > 10
    else if (this.logQueue.length >= 10) {
      this.sendLogs();
    }
  }

  // Metody pomocnicze
  debug(message, data = {}) {
    console.debug(`[${this.source}] ${message}`, data);
    this.log(LOG_LEVELS.DEBUG, message, data);
  }

  info(message, data = {}) {
    console.log(`[${this.source}] ${message}`, data);
    this.log(LOG_LEVELS.INFO, message, data);
  }

  warn(message, data = {}) {
    console.warn(`[${this.source}] ${message}`, data);
    this.log(LOG_LEVELS.WARN, message, data);
  }

  error(message, error = {}) {
    console.error(`[${this.source}] ${message}`, error);
    this.log(LOG_LEVELS.ERROR, message, {
      error: error.toString ? error.toString() : error,
      stack: error.stack
    });
  }
}

// Eksportuj instancje loggerów dla różnych komponentów
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Logger, LOG_LEVELS };
} else {
  // Dla użycia w rozszerzeniu Chrome
  window.Logger = Logger;
  window.LOG_LEVELS = LOG_LEVELS;
}

// Automatyczne wysyłanie logów co 2 sekundy
const globalScope = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : null);
if (globalScope) {
  setInterval(() => {
    // Wysyłaj logi z wszystkich loggerów
    const loggers = globalScope.loggers || (typeof self !== 'undefined' && self.loggers);
    if (loggers) {
      loggers.forEach(logger => logger.sendLogs());
    }
  }, 2000);
}

