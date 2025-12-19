# ETAP 5 – Analiza LLM (PRODUKCJA): Cloud Run + Vertex AI (Gemini) + Firestore

## Przegląd

ETAP 5 opisuje **produkcyjną** analizę LLM dla wiadomości Gmail:

- Extension uruchamia analizę dla `messageId` (i opcjonalnie `threadId`).
- GAS orkiestruje wywołanie backendu w GCP (Cloud Run).
- Cloud Run:
  - sprawdza cache w Firestore,
  - jeśli trzeba: woła Gemini (Vertex AI),
  - zapisuje wynik w Firestore i zwraca JSON do GAS,
  - GAS wykonuje dalsze kroki (np. matching do Zoho, filtracja ignore rules) i zwraca do extension.

**Cel tego dokumentu:** doprecyzować “prawdę systemową” (source of truth) dla analizy, lifecycle, zasady nadpisywania i rolę Firestore.

---

## 1. ADR (Explicit Decision Record): kto jest “Source of Truth” dla analizy?

### 1.1. Decyzja

**Source of truth (SoT) dla wyniku analizy LLM per `messageId` jest Firestore.**

- Extension (`chrome.storage.local`) to **cache UI** / UX (szybki podgląd, stan ✓, krótkotrwałe przechowywanie).
- GAS ma logikę orkiestracji i integracji (Gmail/Zoho/ignore rules), ale **nie jest SoT dla samego wyniku LLM**.
- Cloud Run jest wykonawcą analizy i bramką do SoT (Firestore).

### 1.2. Konsekwencje

- Każda próba ponownej analizy najpierw **sprawdza Firestore** (`/check-cache` lub analogiczny check w `/analyze`).
- “Czy analiza istnieje?” = “czy Firestore ma dokument `messages/{messageId}` z polem `analysis`”.
- UI może pokazywać wynik z `chrome.storage.local`, ale jeśli potrzebujemy pewności / spójności – czytamy z Firestore.

### 1.3. Dlaczego tak?

- Firestore daje: spójność, odporność na restart extension/service worker, prostą deduplikację po `messageId`, możliwość audytu i rozbudowy (np. wersjonowanie, pipeline do CRM).

---

## 2. Definicja “analizy” (ważne: to nie jest fakt)

W tym systemie **analiza LLM nie jest faktem**, tylko:

- **najlepszą możliwą interpretacją treści maila** wykonaną przez **model klasy enterprise**,
- w narzuconym, kontraktowym formacie JSON (systemowy kontrakt danych),
- z nastawieniem na powtarzalność i brak “kreatywności”.

To rozróżnienie jest krytyczne, bo:

- CRM może zawierać dane historyczne, ręcznie uzupełniane lub “prawne” (np. NIP), a email może być niepełny,
- matching i deduplikacja muszą traktować wynik jako **hipotezę**, którą weryfikujemy (np. przez Zoho matching i reguły walidacji).

---

## 3. Lifecycle analizy (per messageId)

### 3.1. Stany (logiczne)

- **Brak analizy**: w Firestore brak dokumentu `messages/{messageId}` lub brak pola `analysis`.
- **Analiza istnieje**: `analysis` jest zapisane w Firestore.
- **Analiza “w trakcie”** (opcjonalnie): gdy wprowadzimy lock/flagę `analysisInProgress` (jeśli potrzebne).

### 3.2. Minimalny flow (rekomendowany)

1. **Pre-check**: GAS wywołuje Cloud Run `/check-cache?messageId=...`
2. Jeśli **cache hit**:
   - GAS pobiera wynik (zwrócony przez endpoint) i przechodzi dalej (np. Zoho matching).
3. Jeśli **cache miss**:
   - GAS pobiera email (Gmail), buduje `fullRawEmail`,
   - woła Cloud Run `/analyze`,
   - Cloud Run zapisuje `analysis` do Firestore,
   - zwraca `analysis` do GAS.

**Uwaga:** Jeżeli `/analyze` ma własny check w Firestore, to i tak utrzymujemy `/check-cache` jako “szybki skrót” (oszczędza pobieranie treści emaila).

---

## 4. Kiedy wolno nadpisać analizę?

### 4.1. Zasada domyślna (bezpieczna)

**Nie nadpisujemy istniejącej analizy w Firestore automatycznie.**

Powód: minimalizujemy koszty (Gemini), unikamy “dryfu” wyników, zachowujemy deterministyczność pracy operatora.

### 4.2. Dopuszczalne powody nadpisania (kontrolowane)

Nadpisanie jest dozwolone tylko, gdy spełniony jest przynajmniej jeden warunek:

- **Wersjonowanie promptu/modelu**: zmieniła się wersja promptu lub modelu, a my chcemy “podnieść jakość”.
- **Błąd analizy**: poprzednia analiza jest niepoprawna technicznie (np. invalid JSON, puste `companies/contacts` przez błąd parse).
- **Zmiana wymagań danych**: doszły nowe pola/kategorie i stara analiza nie zawiera wymaganych elementów.
- **Ręczne wymuszenie** (operator): jawna akcja “Przelicz” / “Force re-run”.

### 4.3. Jak to technicznie kontrolować (kontrakt)

Zalecany kontrakt danych w Firestore (minimum):

- `analyzedAt` – kiedy policzono
- `geminiModel` – na czym policzono
- `promptVersion` – wersja promptu/schematu (np. semver albo hash)

Wtedy reguły nadpisania mogą być zdefiniowane jednoznacznie (np. “nadpisz, jeśli `promptVersion` jest starszy niż wymagany”).

---

## 5. Kiedy analiza jest “stara”?

### 5.1. Definicja “stara” (operacyjna)

Analiza jest “stara”, gdy:

- **schema/prompt/model się zmieniły** i wynik jest nieporównywalny, albo

Nie definiujemy “starości” wyłącznie czasem (np. 30 dni), bo treść wiadomości się nie zmienia. Czas ma znaczenie tylko jako wskaźnik “kiedy policzono” (audyt).

### 5.2. Przykładowe reguły “starości”

- `promptVersion` starszy niż wymagany `PROMPT_VERSION_CURRENT` → traktuj jako “do podbicia”.
- `analysis.companies/contacts` puste, ale mail wygląda na B2B → traktuj jako “podejrzana” (opcjonalnie, na podstawie heurystyk).

---

## 6. Jakość analizy w ETAP 5 (mentalny model)

System ma **jeden** mentalny model jakości:

- **System = Pro. Kropka.**

Nie opisujemy alternatywnych modeli jako opcji biznesowej, nie sugerujemy switchowania ani auto-fallbacków. To redukuje chaos decyzyjny i upraszcza oczekiwania (“to jest najlepsza interpretacja enterprise klasy w kontrakcie JSON”).

---

## 7. Cel Firestore w ETAP 5: cache, knowledge base, pipeline do CRM?

### 7.1. Firestore jako cache (teraz, ETAP 5)

W ETAP 5 Firestore jest przede wszystkim:

- **cache wyników analizy per `messageId`**,
- mechanizm deduplikacji (nie analizuj 2x tego samego maila),
- źródło spójnej prawdy dla “czy analiza istnieje”.

### 7.2. Firestore jako knowledge base (opcjonalnie, ETAP 5+)

Możliwe rozszerzenie, ale **nie jest wymaganiem ETAP 5**:

- trzymanie znormalizowanych encji firm/kontaktów (deduplikacja cross-mail),
- wersjonowanie i linkowanie do źródeł (messageId → encje),
- query “pokaż wszystkie maile od firm z domeny X”.

### 7.3. Firestore jako pipeline do CRM (docelowo, ETAP 5+)

Najbardziej sensowna ścieżka:

- Firestore trzyma wynik analizy + metadane (wersje promptu/modelu, timestamp).
- GAS wykonuje matching do CRM + decyzje (create/update/enrichable).
- Ewentualny kolejny etap: **kolejka zadań** (np. `crm_jobs`) albo stan procesowania (idempotencja) – ale to już poza ETAP 5.

---

## 8. Minimalny kontrakt danych (zalecany) dla dokumentu `messages/{messageId}`

Zalecane pola (minimum operacyjne):

- `messageId` (opcjonalnie, duplikat id dokumentu)
- `threadId`
- `analysis` (JSON: `companies`, `contacts`)
- `analyzedAt` (ms epoch)
- `geminiModel`
- `promptVersion`
- `processingTimeMs`

**Ważne:** ETAP 5 może zacząć od minimum (co już jest), ale ADR zakłada, że Firestore jest SoT – więc metadane muszą pozwolić na bezpieczne decyzje o nadpisaniu.

---

## 9. Testy i weryfikacja (bezpieczne)

### 9.1. Sprawdzenie Cloud Run

- `GET /health` powinien zwracać `status: ok`
- `/check-cache` dla nieznanego `messageId` → `cached: false`

### 9.2. Sprawdzenie SoT

- Po pierwszym `/analyze` dla `messageId` dokument powinien pojawić się w Firestore.
- Drugi raz dla tego samego `messageId`:
  - ma być **cache hit** (bez ponownego liczenia), chyba że jawnie wymusimy “force”.

---

## 10. Co NIE jest częścią ETAP 5 (żeby trzymać minimalny scope)

- Automatyczne nadpisywanie analiz “po czasie”.
- Pełna deduplikacja encji firm/kontaktów między mailami (KB).
- Kolejkowanie, retry, job processing do CRM (pipeline).

Te elementy mogą wejść jako ETAP 6+.


