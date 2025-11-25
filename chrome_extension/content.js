// Content script - wykrywa otwarty mail w Gmail

let lastMessageId = null;

// Funkcja sprawdzająca czy jesteśmy w Gmail i czy mail jest otwarty
function checkGmailState() {
  // Sprawdź czy jesteśmy w Gmail
  if (!window.location.hostname.includes('mail.google.com')) {
    return null;
  }

  // Pobierz gmailMessageId z URL
  const urlParams = new URLSearchParams(window.location.hash.substring(1));
  const messageId = urlParams.get('message_id');
  
  // Alternatywnie, jeśli messageId nie jest w URL, spróbuj znaleźć go w DOM
  let gmailMessageId = messageId;
  let threadId = null;

  if (!gmailMessageId) {
    // Szukaj w data attributes otwartoego maila
    const openEmail = document.querySelector('[data-message-id]');
    if (openEmail) {
      gmailMessageId = openEmail.getAttribute('data-message-id');
    }
  }

  // Pobierz threadId z URL
  const hash = window.location.hash;
  const threadMatch = hash.match(/\/([a-zA-Z0-9]+)$/);
  if (threadMatch) {
    threadId = threadMatch[1];
  }

  return {
    isGmailOpen: true,
    gmailMessageId: gmailMessageId,
    threadId: threadId
  };
}

// Obserwuj zmiany w URL (Gmail używa hash routing)
function observeUrlChanges() {
  let currentUrl = window.location.href;
  
  const observer = new MutationObserver(() => {
    if (currentUrl !== window.location.href) {
      currentUrl = window.location.href;
      checkAndNotify();
    }
  });

  observer.observe(document, {
    subtree: true,
    childList: true
  });
}

// Sprawdź stan i wyślij event jeśli się zmienił
function checkAndNotify() {
  const state = checkGmailState();
  
  if (state && state.gmailMessageId && state.gmailMessageId !== lastMessageId) {
    lastMessageId = state.gmailMessageId;
    
    // Wyślij event do background.js
    chrome.runtime.sendMessage({
      type: 'mail-opened',
      data: {
        gmailMessageId: state.gmailMessageId,
        threadId: state.threadId,
        timestamp: Date.now()
      }
    });
    
    console.log('[Content Script] Mail otwarty:', state);
  }
}

// Inicjalizacja
console.log('[Content Script] Uruchomiono w Gmail');
observeUrlChanges();

// Sprawdź od razu przy załadowaniu
setTimeout(checkAndNotify, 1000);

// Sprawdzaj też co 2 sekundy (backup)
setInterval(checkAndNotify, 2000);

