## SYNC GMAIL – kluczowe warunki poprawnego rozpoznawania stanu + ID (threadId/messageId)

Ten plik opisuje **minimalny zestaw zasad**, które muszą być spełnione, aby rozszerzenie poprawnie wykrywało:
- czy mail jest **zamknięty** / **otwarty**,
- oraz aktualne identyfikatory: **`threadId`** i **`messageId`**,
tak aby ETAP 1/2 działał stabilnie (auto/manual fetch + sidepanel).

---

## 1) Dwa źródła prawdy: `threadId` i `messageId` muszą być niezależne

- **`threadId`** (kontekst wątku):
  - Najczęściej pochodzi z URL Gmaila: `location.href` / `location.hash` w formacie `#inbox/<threadId>` lub `#label/.../<threadId>`.
  - Gmail bywa „podstępny”: w reading-pane czasem zostawia samo `#inbox` → wtedy potrzebny jest fallback (np. link w zaznaczonym mailu na liście).

- **`messageId`** (konkretna wiadomość):
  - Pochodzi z DOM widoku maila w `div[role="main"]` (atrybuty `data-message-id` / `data-legacy-message-id`).
  - Częsty edge-case: atrybut istnieje, ale jest pusty → trzeba ignorować puste wartości.

Wniosek: jeśli jeden z ID jest chwilowo niedostępny, drugi nadal może być wykrywalny – i logika stanów musi to respektować.

---

## 2) Kolejność w `detectGmailState()` jest krytyczna

Kluczowy błąd, który psuje detekcję: **zbyt agresywny “loading”**.

- Gmail potrafi trzymać w DOM elementy wyglądające jak “loading” stale.
- Dlatego detekcja:
  - **najpierw** powinna spróbować odczytać `threadId` + `messageId`,
  - a dopiero potem wolno zwrócić `loading` – **tylko jeśli nie mamy żadnego ID**.

Praktyczna zasada: “loading” nie może blokować wykrycia otwartego maila, jeśli już mamy `threadId` (albo `messageId`).

---

## 3) Stabilna definicja stanów (zamknięte / otwarte)

- **`inbox_list`**:
  - Tylko wtedy, gdy **brak `threadId`** (realnie nie jesteśmy w mailu / brak kontekstu wątku).

- **`loading`**:
  - Gdy mamy **`threadId`**, ale **jeszcze brak `messageId`** (Gmail renderuje treść maila).

- **`mail_opened` / `mail_changed` / `thread_view`**:
  - Dopiero gdy mamy **jednocześnie** `threadId` i `messageId`.

To podejście minimalizuje “flapping” (skakanie stanów) i zapobiega resetowaniu UI w trakcie renderu.

---

## 4) Fallback na `[aria-selected="true"]` musi odróżniać “mail” od “zakładki”

W Gmailu `[aria-selected="true"]` często wskazuje elementy UI typu:
- zakładki “Główne / Oferty / Społecznościowe” (`role="tab`),
zamiast zaznaczonego maila.

Wniosek:
- fallback nie może brać pierwszego lepszego `[aria-selected="true"]`,
- trzeba odfiltrować elementy typu `role="tab"`,
- i szukać elementu, który realnie prowadzi do maila (np. ma link `href` z hash `#.../<threadId>`).

---

## 5) Zasada ETAP2: sidepanel ignoruje “nieaktualne” dane – więc ID muszą być stabilne

ETAP2 celowo chroni UI:
- jeśli odpowiedź (auto/manual fetch) ma inny `messageId`/`threadId` niż aktualny stan,
  to sidepanel **ignoruje wynik**.

To jest poprawne i pożądane, ale ma konsekwencję:
- jeśli `content.js` nie dostarczy prawidłowych ID, cała reszta “wygląda jakby nie działała”.

---

## 6) MV3 / Reload rozszerzenia: “Extension context invalidated”

Po przeładowaniu rozszerzenia (`chrome://extensions` → Reload) Chrome może:
- unieważnić kontekst content scriptu,
- a `chrome.runtime.sendMessage` potrafi wtedy rzucać błąd.

Praktyczna procedura:
- po Reload rozszerzenia → **odśwież kartę Gmail** (Ctrl+R) zanim testujesz detekcję.

---

## 7) Minimalna checklista testu (manual)

- Otwórz maila i w konsoli Gmail:
  - sprawdź `location.href` i `location.hash` (czy zawierają `#.../<threadId>`),
  - sprawdź czy w logach pojawia się przejście do `mail_opened` lub `thread_view`.

- Jeśli utkwi w `loading`:
  - to prawie zawsze oznacza: `threadId` jest, ale `messageId` jeszcze nie jest wykrywalny w DOM (render Gmaila / selektory DOM).

- Jeśli masz `inbox_list` mimo otwartego maila:
  - to oznacza: `threadId` nie został poprawnie wyciągnięty (URL / fallback z listy).


