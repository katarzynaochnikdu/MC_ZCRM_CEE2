// Sidepanel - pokazuje informacje o otwartym mailu

const messageIdElement = document.getElementById('messageId');
const threadIdElement = document.getElementById('threadId');
const statusElement = document.getElementById('status');

// Funkcja aktualizująca UI
function updateUI(data) {
  if (data && data.gmailMessageId) {
    // Wyświetl messageId
    messageIdElement.innerHTML = `<strong>${data.gmailMessageId}</strong>`;
    
    // Wyświetl threadId
    if (data.threadId) {
      threadIdElement.innerHTML = data.threadId;
    } else {
      threadIdElement.innerHTML = '<span class="no-data">-</span>';
    }
    
    // Status aktywny
    statusElement.textContent = 'Mail wykryty';
    statusElement.className = 'status active';
    
    console.log('[Sidepanel] Zaktualizowano UI:', data);
  } else {
    // Brak danych
    messageIdElement.innerHTML = '<span class="no-data">Nie wykryto otwartego maila</span>';
    threadIdElement.innerHTML = '<span class="no-data">-</span>';
    statusElement.textContent = 'Brak danych';
    statusElement.className = 'status inactive';
  }
}

// Nasłuchuj na wiadomości od background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'update-mail') {
    console.log('[Sidepanel] Otrzymano update:', message.data);
    updateUI(message.data);
  }
});

// Przy uruchomieniu sidepanel, zapytaj background.js o aktualny stan
chrome.runtime.sendMessage({
  type: 'get-current-mail'
}, (response) => {
  console.log('[Sidepanel] Pobrano aktualny stan:', response);
  updateUI(response);
});

console.log('[Sidepanel] Zainicjalizowano');

