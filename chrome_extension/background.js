// Background service worker - odbiera eventy od content script

// Przechowuje ostatnio widziany messageId (stan UI, nie dane)
let currentMessageId = null;
let currentThreadId = null;

// Nasłuchuj na wiadomości od content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'mail-opened') {
    console.log('[Background] Otrzymano event mail-opened:', message.data);
    
    // Zapisz stan
    currentMessageId = message.data.gmailMessageId;
    currentThreadId = message.data.threadId;
    
    // Wyślij event do sidepanel
    chrome.runtime.sendMessage({
      type: 'update-mail',
      data: {
        gmailMessageId: currentMessageId,
        threadId: currentThreadId,
        timestamp: message.data.timestamp
      }
    }).catch(() => {
      // Sidepanel może być niezaładowany - to normalne
      console.log('[Background] Sidepanel nie jest otwarty');
    });
    
    sendResponse({ success: true });
  }
  
  return true; // Asynchroniczna odpowiedź
});

// Endpoint dla sidepanel do pobrania aktualnego stanu
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'get-current-mail') {
    console.log('[Background] Sidepanel pyta o aktualny mail');
    sendResponse({
      gmailMessageId: currentMessageId,
      threadId: currentThreadId
    });
  }
  
  return true;
});

console.log('[Background] Service worker uruchomiony');

