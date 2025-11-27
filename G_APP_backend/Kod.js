// Google Apps Script - Backend dla ZCRM CCE2 (ETAP 1 + ETAP 2)
// System logowania do Google Drive + Gmail API fetch

// NAZWA FOLDERU NA DRIVE (możesz zmienić)
const LOG_FOLDER_NAME = 'ZCRM_CCE2_Logs';

// Funkcja do pobrania lub utworzenia folderu z logami
function getOrCreateLogFolder() {
  const folders = DriveApp.getFoldersByName(LOG_FOLDER_NAME);
  
  if (folders.hasNext()) {
    return folders.next();
  } else {
    // Utwórz nowy folder
    const folder = DriveApp.createFolder(LOG_FOLDER_NAME);
    Logger.log('Utworzono folder logów: ' + LOG_FOLDER_NAME);
    return folder;
  }
}

// Funkcja do zapisania logu do pliku
function saveLogToDrive(logData) {
  try {
    const folder = getOrCreateLogFolder();
    
    // Nazwa pliku: data (jeden plik na dzień)
    const now = new Date();
    const timezone = 'Europe/Warsaw'; // Stała strefa czasowa
    const dateStr = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
    const fileName = `log_${dateStr}.txt`;
    
    // Sprawdź czy dzisiejszy plik już istnieje
    const files = folder.getFilesByName(fileName);
    let logFile = null;
    
    if (files.hasNext()) {
      // Plik istnieje - użyj go
      logFile = files.next();
    } else {
      // Utwórz nowy plik
      logFile = folder.createFile(fileName, '=== Log ZCRM CCE2 - ' + dateStr + ' ===\n\n');
    }
    
    // Dodaj log do pliku
    const timestamp = Utilities.formatDate(now, timezone, 'yyyy-MM-dd HH:mm:ss');
    const logEntry = `[${timestamp}] ${logData.source}: ${logData.message}\n`;
    
    // Pobierz istniejącą zawartość i dodaj nowy wpis
    const existingContent = logFile.getBlob().getDataAsString();
    logFile.setContent(existingContent + logEntry);
    
    return {
      success: true,
      fileName: logFile.getName(),
      folderName: LOG_FOLDER_NAME
    };
    
  } catch (error) {
    Logger.log('Błąd zapisu logu: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}

// ========== ETAP 2: Gmail API Fetch Functions ==========

// Funkcja do pobrania pełnej wiadomości (auto-fetch) - BEZ snippet, wszystko jako FULL
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
      to: message.getTo(),
      date: message.getDate().toISOString(),
      plainBody: message.getPlainBody(),  // PEŁNA treść bez obcinania
      bodyLength: message.getPlainBody().length
    };
    
  } catch (error) {
    Logger.log('Błąd fetchMessageSimple: ' + error.toString());
    return {
      success: false,
      error: error.toString()
    };
  }
}

// Funkcja do pobrania pełnych danych wiadomości (manual-fetch)
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

// Funkcja do pobrania pełnego wątku (manual-fetch)
// UWAGA: threadId z URL Gmaila ≠ Gmail API threadId
// Dlatego pobieramy wątek WYŁĄCZNIE przez messageId (który działa w Gmail API)
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
    
    // ========== ETAP 1: Logowanie (jeśli brak action) ==========
    // Walidacja danych
    if (!data.source || !data.message) {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: 'Brak wymaganych pól: source, message'
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Zapisz log do Drive
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

// Funkcja testowa - możesz wywołać z edytora GAS
function testLogging() {
  const testData = {
    source: 'TEST',
    message: 'To jest test logowania',
    level: 'INFO'
  };
  
  const result = saveLogToDrive(testData);
  Logger.log('Wynik testu: ' + JSON.stringify(result));
}

// Funkcja testowa - test Gmail API
function testGmailAPI() {
  // Test pobrania wiadomości
  const threads = GmailApp.getInboxThreads(0, 1);
  if (threads.length > 0) {
    const messages = threads[0].getMessages();
    const message = messages[0];
    
    Logger.log('Message ID: ' + message.getId());
    Logger.log('Subject: ' + message.getSubject());
    Logger.log('From: ' + message.getFrom());
  }
}
