// Google Apps Script - Backend dla ZCRM CCE2
// System logowania do Google Drive

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

// Endpoint doPOST - odbiera logi z rozszerzenia Chrome
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
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
