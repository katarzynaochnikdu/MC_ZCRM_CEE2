// Logger - system logowania do Google Drive przez GAS

// KONFIGURACJA: URL do Twojego Google Apps Script Web App
// Skopiuj URL i wklej tutaj:
const GAS_WEB_APP_URL = 'https://script.google.com/a/macros/med-space.pl/s/AKfycbwX0Oeur5Hx5k0-T8IbgyeK67vhHfepA5lRNypftgL4wDNFeK8-BkrXZTlKzuW39p8/exec';

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

  // Metoda do przechwytywania wszystkich logów z konsoli
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

  // Wysyłaj logi w batch (co 2 sekundy lub gdy kolejka > 10)
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
  // Dla użycia w rozszerzeniu Chrome (różne konteksty)
  if (typeof window !== 'undefined') {
    // Zwykły kontekst przeglądarki (content script, sidepanel)
    window.Logger = Logger;
    window.LOG_LEVELS = LOG_LEVELS;
  } else if (typeof self !== 'undefined') {
    // Service worker / worker – nie ma obiektu window
    self.Logger = Logger;
    self.LOG_LEVELS = LOG_LEVELS;
  }
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

