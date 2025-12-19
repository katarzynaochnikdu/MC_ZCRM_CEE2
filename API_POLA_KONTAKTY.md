# API Pól Kontaktów - Szczegółowa Dokumentacja

## 📋 SPIS TREŚCI
1. [Wszystkie pola API](#wszystkie-pola-api)
2. [Operacje na pojedynczym rekordzie](#operacje-na-pojedynczym-rekordzie)
3. [Operacje na liście rekordów](#operacje-na-liście-rekordów)

---

## 🔌 WSZYSTKIE POLA API

### POLE W APLIKACJI → POLE ZOHO CRM

#### **A. Pola podstawowe (zawsze widoczne)**

| Pole w aplikacji | Pole Zoho CRM | Typ danych | Wymagane | Format/Reguły |
|-----------------|---------------|------------|----------|---------------|
| `firstName` | `First_Name` | `text` | **TAK** (always) | Formatowanie: `formatPersonName()` - pierwsza litera wielka, reszta małe |
| `lastName` | `Last_Name` | `text` | **TAK** (always) | Formatowanie: `formatPersonName()` - pierwsza litera wielka, reszta małe |
| `email` | `Email` | `email` | Nie (optional) | Normalizacja: `normalizeEmail()` - lowercase, trim, walidacja |
| `phone` | `Phone` | `phone` | Nie (optional) | Normalizacja: `normalizePhone()` - format telefonu służbowego |
| `mobile` | `Mobile` | `phone` | Nie (optional) | Normalizacja: `normalizePhone()` - format telefonu komórkowego |
| `designation` | `Designation` | `text` | Nie (optional) | Dowolny tekst - stanowisko |
| `department` | `Department` | `text` | Nie (optional) | Dowolny tekst - dział |

#### **B. Pole typu kontaktu (wymagane do zapisu)**

| Pole w aplikacji | Pole Zoho CRM | Typ danych | Wymagane | Opcje |
|-----------------|---------------|------------|----------|-------|
| `contactType` | `Typ_kontaktu` | `picklist` (single) | **TAK** (required) | - Pracownik medyczny<br>- Pracownik firmy<br>- Pracownik stowarzyszeń i inne<br>- Pracownik usługodawcy/dostawcy |

#### **C. Pola profilowe - Pracownik medyczny**

| Pole w aplikacji | Pole Zoho CRM | Typ danych | Wymagane | Widoczne gdy | Opcje źródło |
|-----------------|---------------|------------|----------|--------------|--------------|
| `medicalProfession` | `Zawod_medyczny` | `picklist` (single) | Conditional | `contactType === 'Pracownik medyczny'` | Zoho API: `/crm/v2/settings/fields?module=Contacts` |
| `hospitalWard` | `Oddzial_w_szpitalu` | `picklist` (single) | Conditional | `contactType === 'Pracownik medyczny'` | Zoho API (cache 24h) |
| `hospitalFunction` | `Funkcja_w_szpitalu_i_lub_oddziale` | `picklist` (multi) | Nie (optional) | `contactType === 'Pracownik medyczny'` | Zoho API - Array wartości |
| `patientGroups` | `Grupa_pacjentow` | `picklist` (multi) | Conditional | `contactType === 'Pracownik medyczny'` | Zoho API - Array wartości |

#### **D. Pola profilowe - Pracownik firmy / Stowarzyszeń**

| Pole w aplikacji | Pole Zoho CRM | Typ danych | Wymagane | Widoczne gdy | Opcje źródło |
|-----------------|---------------|------------|----------|--------------|--------------|
| `profilePosition` | `Stanowisko_profil` | `picklist` (single) | Conditional | `contactType === 'Pracownik firmy'` lub `'Pracownik stowarzyszeń i inne'` | Zoho API |
| `profileDepartment` | `Dzial_profil` | `picklist` (single) | Conditional | `contactType === 'Pracownik firmy'` lub `'Pracownik stowarzyszeń i inne'` | Zoho API |
| `medicalArea` | `Dziedzina_medyczna` | `picklist` (multi) | Conditional | `contactType === 'Pracownik firmy'` lub `'Pracownik stowarzyszeń i inne'` | Zoho API - Array wartości |
| `relatedBrands` | `Marki_powiazane` | `picklist` (multi) | Nie (optional) | `contactType === 'Pracownik firmy'` lub `'Pracownik stowarzyszeń i inne'` | Zoho API - Array wartości |
| `singleUseProducts` | `Produkty_jednorazowe` | `picklist` (multi) | Nie (optional) | `contactType === 'Pracownik firmy'` lub `'Pracownik stowarzyszeń i inne'` | Zoho API - Array wartości |
| `reusableProducts` | `Produkty_wielorazowe` | `picklist` (multi) | Nie (optional) | `contactType === 'Pracownik firmy'` lub `'Pracownik stowarzyszeń i inne'` | Zoho API - Array wartości |
| `drugsAndPreparations` | `Leki_i_preparaty_medyczne` | `picklist` (multi) | Nie (optional) | `contactType === 'Pracownik firmy'` lub `'Pracownik stowarzyszeń i inne'` | Zoho API - Array wartości |

#### **E. Pola profilowe - Dostawca**

| Pole w aplikacji | Pole Zoho CRM | Typ danych | Wymagane | Widoczne gdy | Opcje źródło |
|-----------------|---------------|------------|----------|--------------|--------------|
| `workRegion` | `Region_pracy` | `picklist` (single) | Nie (optional) | `contactType === 'Pracownik usługodawcy/dostawcy'` | Zoho API |

#### **F. Pole relacyjne**

| Pole w aplikacji | Pole Zoho CRM | Typ danych | Wymagane | Format |
|-----------------|---------------|------------|----------|--------|
| `accountId` | `Account_Name` | `lookup` (relacja) | Nie (optional) | Obiekt relacyjny: `{ id: 'zoho-account-id' }` |

---

### SZCZEGÓŁOWY OPIS TYPÓW DANYCH

#### **1. Text (Tekst)**
- **Pola**: `firstName`, `lastName`, `designation`, `department`
- **Formatowanie**:
  - `firstName`, `lastName`: `formatPersonName()` → "Jan Kowalski" (pierwsza litera wielka)
  - `designation`, `department`: Bez formatowania, dowolny tekst
- **Walidacja**: 
  - `lastName` - **WYMAGANE** do zapisu
  - `firstName` - opcjonalne (może być puste)

#### **2. Email**
- **Pole**: `email`
- **Normalizacja**: `normalizeEmail()`
  - Lowercase
  - Trim (usunięcie białych znaków)
  - Walidacja formatu
- **Walidacja**: Opcjonalne (może być puste)

#### **3. Phone**
- **Pola**: `phone`, `mobile`
- **Normalizacja**: `normalizePhone()`
  - Format telefonu
  - Usunięcie białych znaków
- **Walidacja**: Opcjonalne (oba mogą być puste)

#### **4. Picklist (Single)**
- **Pola**: `contactType`, `medicalProfession`, `hospitalWard`, `profilePosition`, `profileDepartment`, `workRegion`
- **Format**: Pojedyncza wartość (string)
- **Źródło opcji**: 
  - `contactType`: Hardcoded w kodzie (4 opcje)
  - Pozostałe: Pobierane z Zoho API (`/crm/v2/settings/fields?module=Contacts`)
  - Cache: 24 godziny (TTL)
- **Zapis**: Jako string z wartością z picklisty

#### **5. Picklist (Multi)**
- **Pola**: `hospitalFunction`, `patientGroups`, `medicalArea`, `relatedBrands`, `singleUseProducts`, `reusableProducts`, `drugsAndPreparations`
- **Format**: Array stringów `['Wartość 1', 'Wartość 2', ...]`
- **Źródło opcji**: Zoho API (cache 24h)
- **Zapis**: Jako tablica wartości w Zoho CRM
- **UI**: Multi-select z chipsami i dropdown z checkboxami

#### **6. Lookup (Relacja)**
- **Pole**: `accountId` → `Account_Name`
- **Format zapisu w Zoho**: `Account_Name: { id: 'zoho-account-id' }`
- **Format w aplikacji**: String z ID (`'123456789012345678'`)

---

## 🎯 OPERACJE NA POJEDYNCZYM REKORDZIE

### 1. **READ (Odczyt)**

#### **1.1. Pobranie danych z formularza**

**Funkcja**: `getValue(field)` i `getMultiValue(field)` w `handleCreateContactById()`

```javascript
// Pojedyncze pole tekstowe/select
const getValue = (field) => {
  const el = document.querySelector(`[data-contact="${contactId}"][data-field="${field}"]`);
  return el ? el.value.trim() : '';
};

// Multi-select (checkboxy)
const getMultiValue = (field) => {
  const wrapper = document.querySelector(`.multi-select-wrapper[data-contact="${contactId}"][data-field="${field}"]`);
  if (!wrapper) return [];
  const checkboxes = wrapper.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
};
```

**Pola odczytywane**:
- Podstawowe: `firstName`, `lastName`, `email`, `phone`, `mobile`, `designation`, `department`
- Typ: `contactType`
- Medyczne: `medicalProfession`, `hospitalWard`, `hospitalFunction` (multi), `patientGroups` (multi)
- Profilowe firmy: `profilePosition`, `profileDepartment`, `medicalArea` (multi), `relatedBrands` (multi), `singleUseProducts` (multi), `reusableProducts` (multi), `drugsAndPreparations` (multi)
- Dostawca: `workRegion`
- Relacja: `linkedAccountId` → `accountId`

**Selektory DOM**:
- Input/select: `[data-contact="${contactId}"][data-field="${field}"]`
- Multi-select: `.multi-select-wrapper[data-contact="${contactId}"][data-field="${field}"]`

---

### 2. **CREATE (Tworzenie)**

#### **2.1. Endpoint API**

**Backend**: `POST /create-contact` (WebApp/Kod.js → `handleCreateContact()`)
**Zoho API**: `POST https://www.zohoapis.eu/crm/v2/Contacts`

#### **2.2. Proces tworzenia**

**Krok 1: Walidacja (Frontend)**
```javascript
if (!contactData.lastName) {
  showStatus('Podaj nazwisko kontaktu', 'error');
  return;
}

if (!contactData.contactType) {
  showStatus('Wybierz typ kontaktu', 'error');
  return;
}
```

**Krok 2: Przygotowanie danych (Frontend → Background)**
```javascript
// sidepanel_v2.js
chrome.runtime.sendMessage({
  type: 'CREATE_CONTACT',
  payload: contactData  // Wszystkie pola z formularza
}, (response) => {
  // Obsługa odpowiedzi
});
```

**Krok 3: Normalizacja (Backend)**
```javascript
// WebApp/Kod.js - handleCreateContact()
contactData.email = normalizeEmail(contactData.email || '');
contactData.firstName = formatPersonName(contactData.firstName || '');
contactData.lastName = formatPersonName(contactData.lastName || '');
```

**Krok 4: Mapowanie do Zoho**
```javascript
var record = {
  First_Name: contactData.firstName,
  Last_Name: contactData.lastName,
  Email: contactData.email,
  Phone: contactData.phone,
  Mobile: contactData.mobile,
  Designation: contactData.designation,
  Department: contactData.department
};

// Typ kontaktu
if (contactData.contactType) {
  record.Typ_kontaktu = contactData.contactType;
}

// Dane profilowe (warunkowo)
if (contactData.medicalProfession) {
  record.Zawod_medyczny = contactData.medicalProfession;
}
// ... pozostałe pola profilowe

// Powiązanie z firmą
if (contactData.accountId) {
  record.Account_Name = { id: contactData.accountId };
}
```

**Krok 5: Wywołanie Zoho API**
```javascript
var result = createZohoRecord('Contacts', record, token);
// Endpoint: POST https://www.zohoapis.eu/crm/v2/Contacts
// Authorization: Zoho-oauthtoken {access_token}
// Payload: { data: [record] }
```

**Krok 6: Aktualizacja UI**
```javascript
contact.crmId = response.id;
contact.existsInCrm = true;
contact.saved = true;
renderContactsAsCards(cardData.contacts);  // Re-render listy
```

#### **2.3. Wymagane pola do utworzenia**

**Minimum**:
- `lastName` (Last_Name) - **WYMAGANE**
- `contactType` (Typ_kontaktu) - **WYMAGANE**

**Pola opcjonalne**:
- Wszystkie pozostałe pola mogą być puste

#### **2.4. Response**

**Sukces**:
```javascript
{
  success: true,
  id: '123456789012345678',  // Zoho Record ID
  message: 'Kontakt dodany do CRM'
}
```

**Błąd**:
```javascript
{
  error: 'Komunikat błędu',
  status: 'error'
}
```

---

### 3. **UPDATE (Aktualizacja)**

#### **3.1. Mechanizm**

**Aktualnie**: System używa tego samego endpointu `CREATE_CONTACT` zarówno do tworzenia jak i aktualizacji.

**Rozpoznanie**:
- Jeśli `contact.existsInCrm === true` → przycisk pokazuje "🔄 Zaktualizuj kontakt w CRM"
- Jeśli `contact.existsInCrm === false` → przycisk pokazuje "✨ Utwórz kontakt w CRM"

**Uwaga**: Zoho CRM automatycznie rozpoznaje duplikaty po Email, więc UPDATE może tworzyć nowy rekord jeśli email się zmienił.

**Aktualizacja w UI**:
```javascript
if (response.id) {
  contact.crmId = response.id;
  contact.existsInCrm = true;
  contact.saved = true;
  renderContactsAsCards(cardData.contacts);
}
```

#### **3.2. Zmiana pól**

**Dozwolone zmiany**:
- Wszystkie pola mogą być edytowane przed zapisem
- Po zapisaniu, edycja wymaga ponownego wywołania `CREATE_CONTACT`

**Edycja w formularzu**:
- Wszystkie pola są edytowalne (input, select, multi-select)
- Zmiana wartości oznacza kartę jako "dirty" (`formDirty = true`)
- Nie ma automatycznego zapisu przy zmianie - wymaga kliknięcia przycisku

---

### 4. **DELETE (Usunięcie)**

**Aktualnie**: Brak operacji DELETE w aplikacji. Kontakty można tylko:
- **Skip** (pominięcie) - `skipContactCandidate(contactId)`
  - Ustawia flagę `contact.skipped = true`
  - Kontakt pozostaje w liście, ale jest przeniesiony na dół
  - **NIE usuwa** z Zoho CRM

```javascript
function skipContactCandidate(contactId) {
  const contact = cardData.contacts.find(c => c.id === contactId);
  if (!contact) return;
  contact.skipped = true;
  renderContactsAsCards(cardData.contacts);  // Re-render z pominięciem
}
```

---

### 5. **OPERACJE POMOCNICZE**

#### **5.1. Wyszukiwanie firmy do powiązania**

**Funkcja**: `handleSearchAccountForContact(contactId)`

```javascript
// UI: Wpisanie nazwy firmy w pole wyszukiwania
// Kliknięcie przycisku 🔍

chrome.runtime.sendMessage({
  type: 'SEARCH_ACCOUNTS',
  payload: { query: 'Nazwa firmy' }
}, (response) => {
  // Wypełnienie dropdown z wynikami
  searchResults = response.results || [];
  // Dodanie opcji do <select>
});
```

**Endpoint Backend**: `POST /search-accounts`
**Zoho API**: `GET /crm/v2/Accounts/search?criteria=(Account_Name:contains:"query")`

**Response**:
```javascript
{
  results: [
    { id: 'zoho-id', displayName: 'Nazwa firmy w CRM' },
    ...
  ]
}
```

#### **5.2. Wybór wartości z pickera**

**Funkcja**: `openValuePickerForContact(type, contactId, field)`

**Typy wartości**:
- `emails` - lista emaili z wiadomości
- `phones` - lista numerów telefonu z wiadomości

**Źródło danych**: `valueCandidates` z `parse-and-check`

```javascript
valueCandidates: {
  emails: [
    { value: 'jan@firma.pl', sources: ['header-from', 'body'] },
    ...
  ],
  phones: [
    { value: '+48 22 123 45 67', sources: ['contact', 'body'] },
    ...
  ]
}
```

**Operacja**:
1. Kliknięcie przycisku ▼ przy polu
2. Otwarcie popover z listą wartości
3. Wybór wartości → automatyczne wypełnienie pola

---

## 📋 OPERACJE NA LIŚCIE REKORDÓW

### 1. **RENDEROWANIE LISTY**

#### **1.1. Funkcja główna**

**Funkcja**: `renderContactsAsCards(contacts)` w `sidepanel_v2.js`

```javascript
function renderContactsAsCards(contacts) {
  const container = document.getElementById('contacts-container');
  container.innerHTML = '';
  
  // Sortowanie
  const sorted = contacts.slice().sort(compareContactCandidates);
  
  // Renderowanie każdej karty
  sorted.forEach((contact, idx) => {
    // Tworzenie elementu DOM karty
    // Dodanie do kontenera
  });
  
  // Dodanie kafelka "+ Dodaj nowy kontakt"
  // Podłączenie event listenerów
}
```

#### **1.2. Sortowanie**

**Funkcja**: `compareContactCandidates(a, b)`

**Kolejność priorytetów**:

1. **Status skipped** - pominięte na dół
   ```javascript
   if (a.skipped && !b.skipped) return 1;
   if (!a.skipped && b.skipped) return -1;
   ```

2. **Status saved** - zapisane na dół
   ```javascript
   if (a.saved && !b.saved) return 1;
   if (!a.saved && b.saved) return -1;
   ```

3. **Kategoria** - według priorytetu kategorii
   ```javascript
   const order = {
     existing_enrichable: 0,  // Najwyższy priorytet
     new_complete: 1,
     new_partial: 2,
     existing_complete: 3     // Najniższy priorytet
   };
   const rankA = order[catA] !== undefined ? order[catA] : 999;
   const rankB = order[catB] !== undefined ? order[catB] : 999;
   if (rankA !== rankB) return rankA - rankB;
   ```

4. **Completeness score** - wyższy score wyżej
   ```javascript
   return (a.completenessScore || 0) > (b.completenessScore || 0) ? -1 : 1;
   ```

**Wynik sortowania**:
```
1. existing_enrichable (najwyższy completenessScore)
2. new_complete (completenessScore >= 0.8)
3. new_partial (completenessScore < 0.8)
4. existing_complete
5. skipped (na końcu)
6. saved (na końcu)
```

---

### 2. **FILTROWANIE**

#### **2.1. Filtrowanie przed renderowaniem**

**Źródło danych**: `handleParseAndCheck()` w `WebApp/Kod.js`

**Filtry automatyczne**:

1. **Ignorowane domeny**:
```javascript
var contactIgnored = cDomain && isIgnoredDomain(cDomain);
if (contactIgnored) {
  c.ignored = true;
  // Kontakt NIE trafia do filteredContacts
}
```

2. **Kontakty bez email**:
   - W praktyce wszystkie kontakty muszą mieć email (walidacja Gemini)

**Wynik**: `filteredContacts` - lista kontaktów do wyświetlenia

#### **2.2. Filtrowanie w UI**

**Aktualnie**: Brak filtrów w UI. Wszystkie kontakty z `cardData.contacts` są wyświetlane (oprócz skipped, które są na dole).

**Filtrowanie skipped**:
- Kontakty z `skipped: true` są renderowane, ale na dole listy (sortowanie)

---

### 3. **WYSZUKIWANIE**

**Aktualnie**: Brak wyszukiwania w liście kontaktów.

**Dostępne wyszukiwanie**:
- Wyszukiwanie firm dla powiązania (`search-accounts`)
- Wyszukiwanie wartości w pickerze (emaile/telefony z wiadomości)

---

### 4. **GRUPOWANIE**

**Aktualnie**: Brak grupowania. Kontakty wyświetlane jako płaska lista.

**Kategoryzacja** (nie grupuje, tylko sortuje):
- `existing_enrichable`
- `new_complete`
- `new_partial`
- `existing_complete`

---

### 5. **OPERACJE MASOWE**

#### **5.1. Skip wszystkich**

**Aktualnie**: Brak operacji masowych. Każdy kontakt musi być pominięty osobno.

#### **5.2. Zapisz wszystkie**

**Aktualnie**: Brak operacji masowych. Każdy kontakt musi być zapisany osobno przez kliknięcie przycisku w karcie.

---

### 6. **OPERACJE NA LIŚCIE - PODSUMOWANIE**

| Operacja | Dostępna | Implementacja |
|----------|----------|---------------|
| **Sortowanie** | ✅ TAK | Automatyczne według kategorii i completenessScore |
| **Filtrowanie** | ⚠ CZĘŚCIOWO | Tylko auto-filtrowanie ignorowanych domen |
| **Wyszukiwanie** | ❌ NIE | Brak wyszukiwania w liście |
| **Grupowanie** | ❌ NIE | Płaska lista (tylko sortowanie) |
| **Skip masowy** | ❌ NIE | Tylko pojedyncze skip |
| **Zapisz masowy** | ❌ NIE | Tylko pojedyncze zapisy |
| **Paginacja** | ❌ NIE | Wszystkie kontakty na raz |
| **Limit wyświetlania** | ❌ NIE | Wszystkie kontakty zawsze widoczne |

---

### 7. **STATUSY I FLAGI NA LIŚCIE**

#### **7.1. Flagi stanu kontaktu**

```javascript
{
  saved: true/false,        // Czy został zapisany w tej sesji
  skipped: true/false,      // Czy użytkownik pominął
  ignored: true/false,      // Czy został zignorowany przez reguły
  existsInCrm: true/false,  // Czy istnieje w Zoho CRM
  justSaved: true/false     // Tymczasowa flaga po zapisaniu (do animacji)
}
```

#### **7.2. Wpływ na renderowanie**

**Saved**:
- Karta pozostaje widoczna
- Badge zmienia się na "✔ Zapisano"
- Przycisk zmienia tekst (choć w praktyce kontakt z `saved: true` nie powinien być ponownie zapisywany)

**Skipped**:
- Karta pozostaje widoczna
- Przeniesiona na dół listy (sortowanie)
- Przycisk skip nadal widoczny

**Ignored**:
- Kontakt **NIE jest renderowany** (filtrowany przed renderowaniem)
- Nie trafia do `filteredContacts`

**Just Saved**:
- Klasa CSS: `.contact-card.just-saved`
- Animacja: `@keyframes cardSaved`
- Automatycznie usuwana po 2 sekundach

---

### 8. **AKTUALIZACJA LISTY**

#### **8.1. Kiedy lista jest re-renderowana**

1. **Po zapisaniu kontaktu**:
```javascript
contact.saved = true;
renderContactsAsCards(cardData.contacts);  // Pełny re-render
```

2. **Po skip kontaktu**:
```javascript
contact.skipped = true;
renderContactsAsCards(cardData.contacts);  // Pełny re-render
```

3. **Po załadowaniu nowych danych**:
```javascript
cardData = response.data;
fillFormWithData(cardData);  // Wywołuje renderContactsAsCards()
```

4. **Po zmianie messageId** (nowy mail):
```javascript
if (currentMsgId !== incomingMsgId) {
  cardData = response.data;
  fillFormWithData(cardData);  // Re-render wszystkich kart
}
```

#### **8.2. Zachowanie stanu UI**

**Zachowywane**:
- Otwarcie karty (`currentContactId`) - jeśli nadal istnieje w nowych danych
- Stan formularzy - **NIE** (formularze są odbudowywane od zera)

**Nie zachowywane**:
- Wprowadzone zmiany w formularzach (chyba że `formDirty` jest sprawdzane przed re-renderem)
- Scroll position

---

### 9. **DODAWANIE NOWEGO KONTAKTU**

#### **9.1. Z modala (Standby)**

**Funkcja**: `openAddContactModal()`

```javascript
// Modal z formularzem (ID: 'manual')
// Po zapisaniu: zamknięcie modala, kontakt NIE trafia do listy
handleCreateContactByIdFromModal('manual');
```

**Uwaga**: Kontakt dodany z modala **NIE jest** dodawany do listy `cardData.contacts`. Tylko zapis w Zoho CRM.

#### **9.2. Z kafelka "+ Dodaj nowy kontakt"**

**Funkcja**: `openAddContactModal()` (ta sama co wyżej)

**Lokalizacja**: Na dole listy kontaktów (`add-button-tile`)

---

## 📊 PODSUMOWANIE OPERACJI

### NA POJEDYNCZYM REKORDZIE

| Operacja | Dostępna | Endpoint | Walidacja |
|----------|----------|----------|-----------|
| **READ** | ✅ TAK | DOM query | - |
| **CREATE** | ✅ TAK | POST /create-contact | lastName, contactType |
| **UPDATE** | ⚠ CZĘŚCIOWO | POST /create-contact | - |
| **DELETE** | ❌ NIE | - | - |
| **SKIP** | ✅ TAK | Lokalnie (JS) | - |
| **Search Account** | ✅ TAK | POST /search-accounts | - |
| **Value Picker** | ✅ TAK | Lokalnie (valueCandidates) | - |

### NA LIŚCIE REKORDÓW

| Operacja | Dostępna | Implementacja |
|----------|----------|---------------|
| **Renderowanie** | ✅ TAK | `renderContactsAsCards()` |
| **Sortowanie** | ✅ TAK | `compareContactCandidates()` |
| **Filtrowanie** | ⚠ CZĘŚCIOWO | Auto-filter ignored |
| **Wyszukiwanie** | ❌ NIE | - |
| **Paginacja** | ❌ NIE | - |
| **Operacje masowe** | ❌ NIE | - |
| **Re-render** | ✅ TAK | Po zapisaniu/skip |

---

*Dokument wygenerowany na podstawie analizy kodu: `WebApp/Kod.js`, `sidepanel_v2.js`, `background.js`*

