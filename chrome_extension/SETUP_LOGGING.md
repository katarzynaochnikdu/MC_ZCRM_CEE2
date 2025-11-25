# 🔧 Konfiguracja Systemu Logowania do Google Drive

## Krok 1: Wdróż Google Apps Script jako Web App

1. Otwórz [Google Apps Script](https://script.google.com)
2. Wybierz projekt **ZCRM_CCE2** (lub utwórz nowy)
3. Skopiuj kod z `G_APP_backend/Kod.js` do edytora
4. Kliknij **"Wdróż"** → **"Nowe wdrożenie"**
5. Kliknij ikonę **⚙️** (Ustawienia) obok "Wybierz typ"
6. Wybierz typ: **"Aplikacja internetowa"**
7. Ustaw:
   - **Wykonaj jako:** "Ja"
   - **Kto ma dostęp:** "Każdy"
8. Kliknij **"Wdróż"**
9. **Skopiuj URL** (będzie wyglądał jak: `https://script.google.com/macros/s/.../exec`)

## Krok 2: Skonfiguruj URL w rozszerzeniu

1. Otwórz plik `chrome_extension/logger.js`
2. Znajdź linię:
   ```javascript
   const GAS_WEB_APP_URL = 'WSTAW_TUTAJ_URL_DO_GAS_WEB_APP';
   ```
3. Wklej skopiowany URL:
   ```javascript
   const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/TWOJ_ID/exec';
   ```

## Krok 3: Przeładuj rozszerzenie

1. Otwórz `chrome://extensions/`
2. Kliknij **"Odśwież"** przy rozszerzeniu ZCRM CCE2
3. Gotowe! 🎉

## Gdzie znajdziesz logi?

1. Otwórz [Google Drive](https://drive.google.com)
2. Szukaj folderu: **`ZCRM_CCE2_Logs`**
3. Wewnątrz znajdziesz pliki: `log_YYYY-MM-DD_HH-mm-ss.txt`

## Format logów

Każdy plik zawiera logi z jednego dnia. Format:
```
[2024-11-18 14:30:25] ContentScript: Stan wykryty: mail_opened
[2024-11-18 14:30:26] Background: Zmiana stanu Gmaila
[2024-11-18 14:30:27] Sidepanel: Zaktualizowano UI stanem
```

## Testowanie

Możesz przetestować system logowania:
1. Otwórz Gmail
2. Otwórz sidepanel rozszerzenia
3. Przejdź między mailami
4. Sprawdź folder `ZCRM_CCE2_Logs` na Drive - powinny pojawić się logi

## Uwagi

- Logi są wysyłane w batch (co 2 sekundy lub gdy jest >10 logów)
- Błędy są wysyłane natychmiast
- Jeśli GAS URL nie jest skonfigurowany, logi będą tylko w konsoli przeglądarki

