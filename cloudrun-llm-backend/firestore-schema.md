# Firestore Schema – Gmail CRM Extension

## Project: `gmail-crm-extension-479113`

---

## Kolekcja: `messages`

Przechowuje wyniki analizy LLM dla każdej wiadomości Gmail.

### Struktura dokumentu

**Document ID:** `messageId` (Gmail Message ID, np. `19ab256bf212d825`)

**Pola:**

```typescript
{
  // Identyfikatory
  threadId: string,              // Gmail Thread ID
  messageId: string,             // Gmail Message ID (redundant, ale dla pewności)
  
  // Analiza LLM
  analysis: {
    companies: Array<{
      company_name: string,
      company_friendly_name: string | null,
      website: string | null,
      phone: string | null,
      email: string | null,
      nip: string | null
    }>,
    contacts: Array<{
      first_name: string,
      last_name: string,
      role: string | null,
      phone: string | null,
      mobile: string | null,
      email: string,
      company_name: string | null,
      salutation: "Pan" | "Pani" | null
    }>
  },
  
  // Metadata
  analyzedAt: number,            // Unix timestamp (Date.now())
  geminiModel: string,           // np. "gemini-2.0-flash-exp"
  processingTimeMs: number,      // Całkowity czas przetwarzania
  
  // Opcjonalne (dla diagnostyki)
  geminiTimeMs?: number,         // Czas wywołania Gemini
  firestoreTimeMs?: number,      // Czas zapisu do Firestore
}
```

---

## Przykład dokumentu

```json
{
  "threadId": "19ab256bf212d825",
  "messageId": "19ab256bf212d825",
  "analysis": {
    "companies": [
      {
        "company_name": "Example Medical Sp. z o.o.",
        "company_friendly_name": "ExMed",
        "website": "exmed.pl",
        "phone": "+48 22 123 45 67",
        "email": "kontakt@exmed.pl",
        "nip": "1234567890"
      }
    ],
    "contacts": [
      {
        "first_name": "Jan",
        "last_name": "Kowalski",
        "role": "Dyrektor ds. Sprzedaży",
        "phone": "+48 22 123 45 68",
        "mobile": "+48 600 123 456",
        "email": "j.kowalski@exmed.pl",
        "company_name": "Example Medical Sp. z o.o.",
        "salutation": "Pan"
      }
    ]
  },
  "analyzedAt": 1732752000000,
  "geminiModel": "gemini-2.5-pro",
  "processingTimeMs": 2345,
  "geminiTimeMs": 2100,
  "firestoreTimeMs": 245
}
```

---

## Indeksy

### Zalecane indeksy (dla późniejszych zapytań):

1. **threadId** (ASC) + **analyzedAt** (DESC)
   - Do pobierania wszystkich analiz w wątku, sortowane chronologicznie

2. **analyzedAt** (DESC)
   - Do pobierania najnowszych analiz (dashboard, monitoring)

### Utworzenie indeksów (Cloud Console):

```
Firestore → Indexes → Create Index

Collection: messages
Fields:
  - threadId (Ascending)
  - analyzedAt (Descending)
Query scope: Collection
```

---

## Reguły bezpieczeństwa (Firestore Rules)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Kolekcja messages - tylko Cloud Run (service account)
    match /messages/{messageId} {
      // Odczyt: tylko dla authenticated users (Cloud Run, GAS)
      allow read: if request.auth != null;
      
      // Zapis: tylko Cloud Run (service account)
      allow write: if request.auth != null;
    }
  }
}
```

**Uwaga:** W ETAP 4.1 autentykacja odbywa się przez Service Account, więc `request.auth != null` będzie działać automatycznie.

---

## Szacunkowe koszty

### Firestore (przykładowe założenia):
- **1000 analiz/miesiąc** = 1000 zapisów + 1000 odczytów
- Rozmiar dokumentu: ~2 KB
- Storage: 1000 × 2 KB = 2 MB

**Koszt:** ~$0.01/miesiąc (praktycznie darmowe dla małych wolumenów)

### Limity Free Tier (Firestore):
- 50,000 reads/day
- 20,000 writes/day
- 1 GB storage

**Wniosek:** Spokojnie mieścisz się w Free Tier przez długi czas.

---

## Monitoring

### Cloud Console → Firestore → Usage

Monitoruj:
- **Document reads/writes** – czy nie przekraczasz limitów
- **Storage size** – czy nie rośnie za szybko (usuwaj stare analizy)
- **Latency** – czy zapisy/odczyty są szybkie (<100ms)

---

## Backup & Retention

### Opcjonalne (dla produkcji):

1. **Automatyczny backup** (Cloud Scheduler + Firestore Export):
   - Codziennie o 2:00 AM
   - Export do Cloud Storage

2. **Retention policy** (usuwanie starych analiz):
   - Skrypt w Cloud Functions / Cloud Run Scheduled
   - Usuń dokumenty starsze niż 90 dni (opcjonalnie)

---

## Migracja z `chrome.storage.local` (ETAP 3 → ETAP 4.1)

W ETAP 3 dane były w `messageCache`:

```javascript
messageCache[messageId] = {
  threadId,
  processed,
  hasAnalysis,
  lastFetchedAt,
  analysisData,  // <- to trafia do Firestore
  analyzedAt     // <- to też
}
```

**W ETAP 4.1:**
- `chrome.storage.local` nadal trzyma `messageCache` (dla szybkiego sprawdzenia `hasAnalysis`)
- **Firestore** trzyma pełną `analysis` (companies, contacts)
- Extension najpierw sprawdza `messageCache.hasAnalysis`, potem jeśli potrzeba pełnych danych → query do Firestore (opcjonalnie w przyszłości)

---

## Rozszerzenia (ETAP 5+)

### Możliwe dodatkowe kolekcje:

1. **`threads/{threadId}`** – agregacja analiz na poziomie wątku
2. **`companies/{companyName}`** – deduplikacja firm
3. **`contacts/{email}`** – deduplikacja kontaktów
4. **`sync_log/{timestamp}`** – historia synchronizacji z Zoho CRM

---

**Koniec schematu Firestore**

