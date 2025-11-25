# ZCRM CCE2 - Chrome Extension (ETAP 0)

## 🟦 Kręgosłup aplikacji

Minimalne rozszerzenie Chrome wykrywające otwarty mail w Gmail.

## Struktura

```
chrome_extension/
├── manifest.json      # Konfiguracja rozszerzenia
├── content.js         # Wykrywa otwarty mail w Gmail
├── background.js      # Service worker - zarządza stanem
├── sidepanel.html     # UI sidepanelu
└── sidepanel.js       # Logika sidepanelu
```

## Funkcjonalność (ETAP 0)

### Content Script (`content.js`)
- Wykrywa czy Gmail jest otwarty
- Identyfikuje jaki mail jest otwarty
- Pobiera `gmailMessageId`
- Pobiera `threadId`
- **NIE** rusza body maila

### Background (`background.js`)
- Odbiera event `mail-opened` od content script
- Przechowuje ostatnio widziany `messageId` (stan UI, nie dane)
- Wysyła event do sidepanel

### Sidepanel (`sidepanel.html` + `sidepanel.js`)
- Pokazuje: "Otwarty mail: [messageId]"
- Pokazuje threadId jeśli dostępny
- **NIC** więcej

## Instalacja

1. Otwórz Chrome
2. Wejdź na `chrome://extensions/`
3. Włącz "Tryb dewelopera" (prawy górny róg)
4. Kliknij "Załaduj rozpakowane"
5. Wybierz folder `chrome_extension`

## Testowanie

1. Załaduj rozszerzenie
2. Otwórz Gmail (https://mail.google.com)
3. Otwórz dowolny mail
4. Kliknij ikonę rozszerzenia i otwórz sidepanel
5. W sidepanel powinien pojawić się messageId otwartego maila

## Logi (do debugowania)

- Otwórz DevTools w Gmail (F12)
- Sprawdź konsolę - powinny być logi `[Content Script]`
- Kliknij prawym na ikonę rozszerzenia → "Inspect service worker" → sprawdź logi `[Background]`
- W sidepanel również otwórz DevTools → sprawdź logi `[Sidepanel]`

---

**UWAGA:** To jest ETAP 0 - sam kręgosłup. Nie pobieramy jeszcze treści maili ani nie łączymy się z żadnym API.

